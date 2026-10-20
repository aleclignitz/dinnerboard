/*
 * Supabase adapter for Dinner Board.
 *
 * The board (board/supper-board.html) only ever calls
 * window.claude.use("db") and window.claude.use("user"), then uses the
 * returned db.doc(path)/db.collection(path) with get/set/update/delete/
 * onSnapshot. This file implements that same shape on top of Supabase, so
 * the board's own code never needs to change. Each board "document" is one
 * row in the `documents` table, keyed by its path (e.g. "meals/abc123").
 *
 * Requires board/config.js (SUPABASE_CONFIG) and the Supabase JS CDN
 * script to be loaded first.
 */
(function () {
  "use strict";

  var client = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.publishableKey
  );

  function freeze(o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); }
  function idOf(path) { return path.split("/").pop(); }
  function newId() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2, 12); }

  // Mirrors the shim's nested-merge semantics, including {__delete__:true}.
  function mergeDeep(target, src) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) { delete target[k]; return; }
      if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
        mergeDeep(target[k], v);
      } else {
        target[k] = freeze(v);
      }
    });
  }

  async function fetchRow(path) {
    var res = await client.from("documents").select("data").eq("path", path).maybeSingle();
    if (res.error) throw res.error;
    return res.data ? res.data.data : undefined;
  }

  function docSnap(path, data) {
    return { id: idOf(path), exists: data !== undefined, data: function () { return freeze(data); } };
  }

  function docRef(path) {
    return {
      id: idOf(path),
      path: path,
      get: async function () { return docSnap(path, await fetchRow(path)); },
      set: async function (data) {
        var res = await client.from("documents").upsert({ path: path, data: freeze(data), updated_at: new Date().toISOString() });
        if (res.error) throw res.error;
      },
      update: async function (patch) {
        var current = await fetchRow(path);
        if (current === undefined) throw new Error("Document does not exist: " + path);
        var next = freeze(current);
        mergeDeep(next, patch);
        var res = await client.from("documents").update({ data: next, updated_at: new Date().toISOString() }).eq("path", path);
        if (res.error) throw res.error;
      },
      delete: async function () {
        var res = await client.from("documents").delete().eq("path", path);
        if (res.error) throw res.error;
      },
      onSnapshot: function (next, errCb) {
        function push() { fetchRow(path).then(function (data) { next(docSnap(path, data)); }).catch(function (e) { if (errCb) errCb(e); }); }
        push();
        var channel = client.channel("doc:" + path)
          .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, function (payload) {
            var row = (payload.new && payload.new.path) ? payload.new : payload.old;
            if (row && row.path === path) push();
          })
          .subscribe();
        return function () { client.removeChannel(channel); };
      },
      collection: function (sub) { return colRef(path + "/" + sub); }
    };
  }

  function colRef(path) {
    var prefix = path + "/";
    async function fetchAll() {
      var res = await client.from("documents").select("path,data").like("path", prefix + "%");
      if (res.error) throw res.error;
      return (res.data || []).filter(function (r) { return r.path.slice(prefix.length).indexOf("/") === -1; });
    }
    function colSnap(rows) {
      var docs = rows.map(function (r) { return docSnap(r.path, r.data); });
      return { docs: docs, size: docs.length, empty: !docs.length };
    }
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || newId())); },
      add: async function (data) { var ref = this.doc(); await ref.set(data); return ref; },
      get: async function () { return colSnap(await fetchAll()); },
      onSnapshot: function (next, errCb) {
        function push() { fetchAll().then(function (rows) { next(colSnap(rows)); }).catch(function (e) { if (errCb) errCb(e); }); }
        push();
        var channel = client.channel("col:" + path)
          .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, push)
          .subscribe();
        return function () { client.removeChannel(channel); };
      }
    };
  }

  // Extras beyond the db/user shim, used by the Settings tab.
  window.dinnerboard = {
    recipeCount: async function () {
      var res = await client.from("recipes").select("id", { count: "exact", head: true });
      if (res.error) throw res.error;
      return res.count || 0;
    },
    // Asks the dispatch-workflow edge function to start an allow-listed workflow.
    startWorkflow: async function (name) {
      var res = await client.functions.invoke("dispatch-workflow", { body: { workflow: name } });
      if (res.error) throw res.error;
      return res.data;
    },
    // Removes every planned (current + next) meal. History and ratings are kept.
    clearPlan: async function () {
      var cols = ["meals", "draft"];
      for (var i = 0; i < cols.length; i++) {
        var del = await client.from("documents").delete().like("path", cols[i] + "/%");
        if (del.error) throw del.error;
      }
      var d = await client.from("documents").delete().eq("path", "plan/draft");
      if (d.error) throw d.error;
      var cur = await fetchRow("plan/current");
      if (cur !== undefined) {
        var next = freeze(cur);
        next.status = "active"; next.pickup = ""; next.statusNote = ""; delete next.start; delete next.end;
        var up = await client.from("documents").update({ data: next, updated_at: new Date().toISOString() }).eq("path", "plan/current");
        if (up.error) throw up.error;
      }
    }
  };

  window.claude = {
    use: async function (name) {
      if (name === "db") return { doc: docRef, collection: colRef };
      if (name === "user") {
        var session = (await client.auth.getSession()).data.session;
        return {
          isOwner: async function () { return true; },
          canEdit: async function () { return !!session; },
          can: async function () { return !!session; },
          id: async function () { return session ? session.user.id : null; }
        };
      }
      return null;
    }
  };

  // ---------- minimal sign-in gate ----------
  // The board only loads data once window.claude is in place, so block
  // rendering behind a magic-link sign-in until there's a session.
  function showSignIn() {
    if (!document.body) { document.addEventListener("DOMContentLoaded", showSignIn, { once: true }); return; }
    var bar = document.createElement("div");
    bar.id = "sb-signin";
    bar.style.cssText = "position:fixed;inset:0;background:#FBF4EA;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif";
    bar.innerHTML =
      '<form style="max-width:320px;width:100%;display:flex;flex-direction:column;gap:12px">' +
      '<h1 style="font-size:1.2rem;margin:0">Sign in to Dinner Board</h1>' +
      '<input type="email" required placeholder="you@example.com" style="padding:10px;border:1px solid #ccc;border-radius:8px">' +
      '<input type="password" placeholder="Password (optional)" style="padding:10px;border:1px solid #ccc;border-radius:8px">' +
      '<button type="submit" style="padding:10px;border:0;border-radius:8px;background:#B5322A;color:#fff;font-weight:700">Sign in</button>' +
      '<p style="font-size:.8rem;color:#7A6354;margin:0">Leave the password blank to get a magic link by email instead.</p>' +
      '<p class="sb-status" style="font-size:.85rem;color:#7A6354;margin:0"></p>' +
      '</form>';
    document.body.appendChild(bar);
    var form = bar.querySelector("form");
    var status = bar.querySelector(".sb-status");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = form.querySelector('input[type="email"]').value.trim();
      var password = form.querySelector('input[type="password"]').value;
      if (password) {
        status.textContent = "Signing in...";
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        status.textContent = res.error ? ("Error: " + res.error.message) : "";
      } else {
        status.textContent = "Sending...";
        var res2 = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } });
        status.textContent = res2.error ? ("Error: " + res2.error.message) : "Check your email for the link.";
      }
    });
  }

  client.auth.getSession().then(function (res) {
    if (!res.data.session) showSignIn();
  });
  client.auth.onAuthStateChange(function (event, session) {
    if (!session) return;
    var bar = document.getElementById("sb-signin");
    if (bar) {
      bar.remove();
      // Sign-in that happens without a page navigation (password sign-in) leaves
      // the board's data subscriptions stuck on their earlier unauthenticated,
      // RLS-empty fetch - reload once so they re-run with the real session.
      if (event === "SIGNED_IN") location.reload();
    }
  });
})();
