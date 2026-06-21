// PWA「ホーム画面に追加」の共通ロジック。
// beforeinstallprompt はページ読込直後に一度だけ発火するため、ここでグローバルに捕捉しておき、
// バナー(AddToHome)でも設定の常設ボタン(InstallButton)でも再利用できるようにする
// （＝バナーを閉じた後でも「設定」からいつでも追加できる）。早期import(layoutのAddToHome経由)で確実に捕捉。

type InstallEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome?: string }> };

let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
let wired = false;

function notify() {
  subs.forEach((f) => {
    try {
      f();
    } catch {
      /* noop */
    }
  });
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // ミニ情報バーを抑止し、自前のUIから任意のタイミングで出せるようにする
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}
wire();

// ネイティブのインストールプロンプト(Android/Chrome等)が今すぐ出せるか。
export function canInstallNative(): boolean {
  return deferred !== null;
}

// プロンプトの取得状況が変わったら呼ばれる購読（UIの再描画用）。返り値で解除。
export function onInstallChange(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// ネイティブのインストールプロンプトを表示する。1つの event は一度しか使えないので使用後は破棄。
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  deferred.prompt();
  let outcome: string | undefined;
  try {
    outcome = (await deferred.userChoice)?.outcome;
  } catch {
    /* noop */
  }
  deferred = null;
  notify();
  return outcome === "accepted" ? "accepted" : "dismissed";
}

export interface PwaEnv {
  isIOS: boolean;
  isAndroid: boolean;
  inApp: boolean; // X/LINE等のアプリ内ブラウザ（PWAインストール不可）
  standalone: boolean; // 既にホーム画面から起動している（インストール済み）
}

export function pwaEnv(): PwaEnv {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { isIOS: false, isAndroid: false, inApp: false, standalone: false };
  }
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const inApp = /Twitter|FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|musical_ly/i.test(ua);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return { isIOS, isAndroid, inApp, standalone };
}
