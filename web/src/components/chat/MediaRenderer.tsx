import { Show, createSignal, onCleanup } from "solid-js";
import { Message } from "../../types";
import { mediaUrl } from "../../utils";
import { DownloadIcon, FileIcon, GalleryBrokenIcon } from "../Icons";
import AudioPlayer from "./AudioPlayer";
import VideoNotePlayer from "./VideoNotePlayer";

interface MediaRendererProps {
  msg: Message;
  isMe: boolean;
  onImageClick: (src: string) => void;
  onViewOnceConsumed: (messageId: string) => void;
}

function ViewOnceMedia(props: {
  msg: Message;
  onConsumed: (messageId: string) => void;
}) {
  const [source, setSource] = createSignal<string | null>(null);
  const [consumed, setConsumed] = createSignal(false);

  function discard() {
    const url = source();
    if (url) URL.revokeObjectURL(url);
    setSource(null);
  }

  function reveal() {
    const encoded = props.msg.view_once_data;
    if (!encoded || consumed()) return;

    try {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      // View Once bytes stay in this component's memory only; never persist or expose download controls.
      const blob = new Blob([bytes], {
        type: props.msg.view_once_mime || "application/octet-stream",
      });
      setSource(URL.createObjectURL(blob));
      setConsumed(true);
      props.onConsumed(props.msg.message_id);
    } catch {
      setConsumed(true);
      props.onConsumed(props.msg.message_id);
    }
  }

  onCleanup(discard);

  return (
    <div class="my-1">
      <Show
        when={source()}
        fallback={
          <Show
            when={props.msg.view_once_data && !consumed()}
            fallback={
              <Show when={consumed()}>
                <span class="text-metadata uppercase">VIEW_ONCE_CONSUMED</span>
              </Show>
            }
          >
            <button class="tag tag-accent" onClick={reveal}>
              VIEW_ONCE
            </button>
          </Show>
        }
      >
        {(src) => (
          <div class="relative max-w-80 rounded-lg overflow-hidden border border-border-visible bg-black">
            <Show
              when={(props.msg.view_once_mime || "").startsWith("video/")}
              fallback={
                <img
                  src={src()}
                  alt="View Once media"
                  class="max-h-100 max-w-full object-contain"
                  onContextMenu={(event) => event.preventDefault()}
                />
              }
            >
              <video
                src={src()}
                controls
                autoplay
                preload="metadata"
                controlslist="nodownload"
                disablepictureinpicture
                class="w-full max-h-100"
                onEnded={discard}
                onContextMenu={(event) => event.preventDefault()}
              />
            </Show>
            <button class="tag absolute top-2 right-2 bg-black" onClick={discard}>
              CLOSE
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

export function MediaRenderer(props: MediaRendererProps) {
  const m = () => props.msg;
  const src = () => m().media_path ? mediaUrl(m().media_path!) : null;
  const type = () => m().type;
  const mt = () => (m().media_type || "").toLowerCase();

  return (
    <Show when={m().is_view_once} fallback={
      <Show when={src()} fallback={
      <Show when={type() !== "chat"}>
        <div class="flex items-center gap-3 p-3 bg-surface-raised border border-border rounded-lg text-[10px] font-mono font-bold text-text-disabled uppercase tracking-widest my-1 min-w-50">
          <GalleryBrokenIcon size={18} class="text-accent/30" />
          {`[ ${type().toUpperCase().replace("MESSAGE", "")} ]`}
        </div>
      </Show>
      }>
      {(s) => (
        <Show when={type() === "ptv"} fallback={
          <Show when={type() === "image" || type().includes("sticker") || mt().startsWith("image/")} fallback={
            <Show when={type() === "video" || mt().startsWith("video/")} fallback={
              <Show when={type() === "audio" || type() === "ptt" || mt().startsWith("audio/")} fallback={
                <div class="flex items-center gap-3 p-3 bg-surface-raised rounded-lg text-caption border border-border-visible">
                  <FileIcon size={14} />
                  <div class="flex flex-col flex-1 overflow-hidden">
                    <a href={s()} target="_blank" rel="noopener" class="text-accent underline truncate">
                      {m().media_filename || "Download"}
                    </a>
                    <span class="text-metadata text-[8px] mt-0.5">ATTACHMENT_{type().toUpperCase()}</span>
                  </div>
                  <a href={s()} download={m().media_filename || "download"} aria-label="Download file" class="ml-auto w-8 h-8 rounded-full bg-border flex items-center justify-center hover:bg-accent hover:text-white transition-colors">
                    <DownloadIcon size={14} stroke-width={2.5} />
                  </a>
                </div>
              }>
                <div class="flex flex-col gap-2 my-1 max-w-80">
                  <AudioPlayer src={s()} isMe={props.isMe} filename={m().media_filename || "voice-note"} />
                </div>
              </Show>
            }>
              <div class="group relative rounded-lg overflow-hidden my-1 max-w-80 border border-border-visible bg-black">
                <video src={s()} controls preload="metadata" class="w-full max-h-75" />
                <a href={s()} download={m().media_filename || "download"} aria-label="Download video" class="absolute top-3 right-3 w-8 h-8 rounded-full bg-[rgba(0,0,0,0.4)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 mobile-visible focus-visible:opacity-100 focus-visible:bg-accent transition-all hover:bg-accent border border-border outline-none focus-visible:ring-2 ring-accent ring-offset-2 ring-offset-black">
                  <DownloadIcon size={14} stroke-width={2.5} />
                </a>
              </div>
            </Show>
          }>
            <div class="group relative rounded-lg overflow-hidden my-1 max-w-80" classList={{ "bg-transparent max-w-[180px]": type().includes("sticker") || mt() === "image/webp" }}>
              <img src={s()} alt="Media" loading="lazy" class="w-full cursor-pointer hover:opacity-90 transition-opacity rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ring-accent" onClick={() => props.onImageClick(s())} role="button" tabIndex={0} onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onImageClick(s());
                }
              }} />
              <Show when={!type().includes("sticker") && mt() !== "image/webp"}>
                <a href={s()} download={m().media_filename || "download"} aria-label="Download" class="absolute top-2 right-2 w-8 h-8 rounded-full bg-[rgba(0,0,0,0.4)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 mobile-visible focus-visible:opacity-100 focus-visible:bg-accent transition-all hover:bg-accent border border-border">
                  <DownloadIcon size={14} stroke-width={2.5} />
                </a>
              </Show>
            </div>
          </Show>
        }>
          <VideoNotePlayer src={s()} />
        </Show>
      )}
      </Show>
    }>
      <ViewOnceMedia
        msg={m()}
        onConsumed={props.onViewOnceConsumed}
      />
    </Show>
  );
}
