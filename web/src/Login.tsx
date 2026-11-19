import { createSignal, Show, onMount, onCleanup, createMemo } from "solid-js";
import { login, enableTotp, fetchUptime } from "./api";
import { setAuthenticated } from "./store";
import { notify } from "./notify";
import { EyeIcon, SunColoredIcon, MoonColoredIcon } from "./components/Icons";
import { theme, setTheme } from "./store";
import { renderSVG } from "uqr";

export default function Login() {
  const [username, setUsername] = createSignal("whatsapp-monitor");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [showPassword, setShowPassword] = createSignal(false);
  const [uptimeSeconds, setUptimeSeconds] = createSignal(0);
  const [authStep, setAuthStep] = createSignal<"password" | "totp" | "setup">("password");
  const [totpCode, setTotpCode] = createSignal("");
  const [totpSetup, setTotpSetup] = createSignal<{ secret: string; otpAuthUrl: string } | null>(null);
  const totpQr = createMemo(() => {
    const uri = totpSetup()?.otpAuthUrl;
    return uri ? `data:image/svg+xml,${encodeURIComponent(renderSVG(uri))}` : "";
  });

  onMount(async () => {
    try {
      const data = await fetchUptime();
      setUptimeSeconds(data.uptime);
    } catch {
      setUptimeSeconds(2142720); // Fallback to 24.8d
    }

    const timer = setInterval(() => {
      setUptimeSeconds(prev => prev + 1);
    }, 1000);

    onCleanup(() => clearInterval(timer));
  });
  
  function toggleTheme() {
    setTheme(theme() === "dark" ? "light" : "dark");
  }

  const formatUptime = (totalSeconds: number) => {
    const d = Math.floor(totalSeconds / (24 * 3600));
    const h = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${d}D ${h}H ${m}M ${s}S`;
  };

  async function getFingerprint(): Promise<string> {
    try {
      const tm = await import("thumbmarkjs");
      return await tm.getFingerprint();
    } catch {
      return fallbackFingerprint();
    }
  }

  function fallbackFingerprint(): string {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("fp", 2, 2);
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      canvas.toDataURL(),
    ].join("|");
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLoading(true);
    try {
      const fp = await getFingerprint();
      const result = authStep() === "setup"
        ? await enableTotp(password(), fp, totpCode())
        : await login(password(), fp, authStep() === "totp" ? totpCode() : undefined);

      if ("requiresTotpSetup" in result && result.requiresTotpSetup) {
        if (!result.secret || !result.otpAuthUrl) {
          throw new Error("Authenticator setup could not be loaded.");
        }
        setTotpSetup({ secret: result.secret, otpAuthUrl: result.otpAuthUrl });
        setTotpCode("");
        setAuthStep("setup");
        return;
      }

      if ("requiresTotp" in result && result.requiresTotp) {
        setTotpCode("");
        setAuthStep("totp");
        return;
      }

      if (!result.success || !result.token) {
        throw new Error("Sign-in could not be completed.");
      }

      localStorage.setItem("fingerprint", fp); // Persist fingerprint for API requests
      setAuthenticated(true);
      notify.success("Access Granted", authStep() === "setup" ? "Authenticator enabled." : "Session established.");
    } catch (err: any) {
      notify.warning(
        "Access Denied",
        err instanceof Error ? err.message : "Invalid authentication key."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="flex flex-col items-center justify-center min-h-dvh w-full bg-bg text-text-primary selection:bg-accent/30 overflow-hidden relative p-4 md:p-6">
      <div 
        class="relative z-10 w-full card bg-surface p-0 animate-entrance"
        style={{"max-width":"480px"}}
      >
        {/* Top Header Bar */}
        <div class="border-b border-border px-4 md:px-6 py-3 md:py-4 flex items-center justify-between text-label bg-surface-raised/50">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 text-text-primary">
              <span class="w-1.25 h-1.25 bg-accent rounded-[1px] animate-pulse-slow" />
              <span>ONLINE</span>
            </div>
            <span class="opacity-50">RECALL</span>
          </div>
          <button
            class="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:bg-border-visible hover:text-text-primary transition-all active:tick focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={toggleTheme}
            title={theme() === "dark" ? "Light Mode" : "Dark Mode"}
            aria-label={theme() === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <Show when={theme() === "dark"} fallback={<MoonColoredIcon size={16} />}>
              <SunColoredIcon size={16} />
            </Show>
          </button>
        </div>

        {/* Hero Section — compact on mobile */}
        <div class="px-6 md:px-8 py-8 md:py-12 border-b border-border">
          <h1 class="text-display-md md:text-display-lg text-text-display uppercase mb-2">
            {authStep() === "setup" ? <>SET UP<br/>AUTHENTICATOR</> : authStep() === "totp" ? <>VERIFY<br/>CODE</> : <>SIGN<br/>IN</>}
          </h1>
          <div class="flex items-center gap-4 text-metadata opacity-40">
            <span>Secure Access</span>
            <div class="h-px grow bg-border" />
          </div>
        </div>

        <form onSubmit={handleSubmit} class="p-0">
          {/* Identity Field — responsive label */}
          <Show when={authStep() === "password"}>
            <div class="flex flex-col md:grid md:grid-cols-[120px_1fr] border-b border-border group focus-within:bg-border/5 transition-colors">
              <label
                for="username-field"
                class="md:border-r border-b md:border-b-0 border-border px-4 md:px-6 py-3 md:py-6 flex items-center text-label font-bold cursor-pointer"
              >
                USERNAME
              </label>
              <input
                id="username-field"
                type="text"
                name="username"
                autocomplete="username"
                placeholder="USER_ID"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                class="w-full bg-transparent px-4 md:px-6 py-4 md:py-6 outline-none text-[13px] font-mono tracking-[0.15em] md:tracking-[0.2em] uppercase placeholder:opacity-20 text-text-primary"
              />
            </div>
          </Show>

          {/* Access Key Field — responsive label */}
          <Show when={authStep() === "password"}>
            <div class="flex flex-col md:grid md:grid-cols-[120px_1fr] border-b border-border group focus-within:bg-border/5 transition-colors relative">
              <label
                for="password-field"
                class="md:border-r border-b md:border-b-0 border-border px-4 md:px-6 py-3 md:py-6 flex items-center text-label font-bold cursor-pointer"
              >
                PASSWORD
              </label>
              <div class="relative flex items-center grow">
                <input
                  id="password-field"
                  type={showPassword() ? "text" : "password"}
                  name="password"
                  autocomplete="current-password"
                  placeholder="**********"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  required
                  autofocus
                  class="w-full bg-transparent px-4 md:px-6 py-4 md:py-6 outline-none text-[13px] font-mono tracking-[0.3em] md:tracking-[0.4em] placeholder:opacity-20 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword())}
                  class="absolute right-4 p-2 text-text-disabled hover:text-text-primary transition-colors cursor-pointer"
                  aria-label={showPassword() ? "Hide password" : "Show password"}
                >
                  <EyeIcon size={16} />
                </button>
              </div>
            </div>
          </Show>

          <Show when={authStep() !== "password"}>
            <Show when={authStep() === "setup"}>
              <div class="flex flex-col items-center gap-3 border-b border-border p-5 text-center">
                <p class="text-label uppercase">SCAN WITH AN AUTHENTICATOR APP</p>
                <img
                  src={totpQr()}
                  alt="Authenticator setup QR code"
                  class="h-56 w-56 bg-white p-2"
                />
                <p class="text-metadata uppercase opacity-60">OR ENTER THIS SECRET MANUALLY</p>
                <code class="text-label break-all select-all">{totpSetup()?.secret}</code>
              </div>
            </Show>
            <div class="flex flex-col md:grid md:grid-cols-[120px_1fr] border-b border-border group focus-within:bg-border/5 transition-colors">
              <label
                for="totp-code"
                class="md:border-r border-b md:border-b-0 border-border px-4 md:px-6 py-3 md:py-6 flex items-center text-label font-bold cursor-pointer"
              >
                {authStep() === "setup" ? "CONFIRM CODE" : "AUTHENTICATOR"}
              </label>
              <input
                id="totp-code"
                type="text"
                name="totp-code"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxlength={6}
                placeholder="000000"
                value={totpCode()}
                onInput={(e) => setTotpCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                required
                autofocus
                class="w-full bg-transparent px-4 md:px-6 py-4 md:py-6 outline-none text-[13px] font-mono tracking-[0.3em] placeholder:opacity-20"
              />
            </div>
            <div class="px-5 pt-4">
              <button
                type="button"
                onClick={() => { setAuthStep("password"); setTotpCode(""); }}
                class="btn btn-secondary w-full"
              >
                BACK
              </button>
            </div>
          </Show>

          {/* Action Button */}
          <div class="p-5 md:p-8">
            <button
              type="submit"
              disabled={loading()}
              class="btn btn-primary w-full py-5 md:py-6"
            >
              <Show when={!loading()} fallback={"AUTHENTICATING..."}>
                {authStep() === "setup" ? "ENABLE AUTHENTICATOR" : authStep() === "totp" ? "VERIFY CODE" : "SIGN IN"}
              </Show>
            </button>
          </div>
        </form>

        {/* Footer Meta Data */}
        <div class="border-t border-border grid grid-cols-2 bg-surface-raised/30">
          <div class="border-r border-border p-4 md:p-5 flex flex-col gap-1">
            <span class="text-metadata uppercase opacity-40">STATUS</span>
            <div class="flex items-center gap-2">
               <div class="w-1.25 h-1.25 bg-accent rounded-[1px]" />
              <span class="text-label text-text-primary">ACTIVE</span>
            </div>
          </div>
          <div class="p-4 md:p-5 flex flex-col gap-1">
            <span class="text-metadata uppercase opacity-40">UPTIME</span>
            <span class="text-label text-text-primary">{formatUptime(uptimeSeconds())}</span>
          </div>
        </div>

        {/* Bottom Decorative Bar */}
        <div class="border-t border-border p-3 md:p-4 text-metadata opacity-40 text-center uppercase tracking-widest">
          SECURE_ACCESS
        </div>
      </div>
    </div>

  );
}
