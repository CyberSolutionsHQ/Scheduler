import { getSupabase } from "../supabaseClient.js";
import { getCurrentUserProfile, goToLogin } from "../auth.js";
import { toast } from "../ui.js";

(async () => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const profile = await getCurrentUserProfile();
      if (profile?.role === "platform_admin") location.href = "./admin.html";
      else location.href = "./dashboard.html";
    } else {
      goToLogin({ next: "dashboard.html" });
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), { type: "error", ms: 9000 });
  }
})();
