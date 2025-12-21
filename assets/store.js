/* assets/store.js
   Legacy offline store disabled. This stub avoids localStorage usage.
*/

(() => {
  const stub = {
    init: async () => {},
    getSaved: () => ({}),
    getDraft: () => ({}),
    resetDraftToSaved: async () => {},
    isDirty: () => false,
    save: async () => {},
    setSession: () => {},
    getSession: () => null,
    clearSession: () => {},
  };

  window.JanitorStore = stub;
})();
