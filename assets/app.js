/* assets/app.js
   Legacy UI disabled. This stub avoids localStorage usage.
*/

(() => {
  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[m]);

  const toast = (message) => {
    const text = String(message ?? "").trim();
    if (!text) return;
    window.alert(text);
  };

  const confirmBox = async (message) => window.confirm(String(message ?? ""));

  const downloadText = (filename, text, mime = "text/plain") => {
    const blob = new Blob([String(text ?? "")], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const init = async ({ pageTitle } = {}) => {
    if (pageTitle) document.title = String(pageTitle);
  };

  window.JanitorApp = {
    init,
    escapeHtml,
    toast,
    confirmBox,
    downloadText,
    markDirty: () => {},
    updateRequestBadges: () => {},
  };

  window.JanitorAuth = {
    getSession: () => null,
    signOut: () => {
      location.href = "./login.html";
    },
  };
})();
