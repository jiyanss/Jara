"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface VoiceSearchProps {
  onResult: (text: string) => void;
}

const MAX_DURATION_MS = 8000;

/**
 * Voice search: records the user's microphone, transcribes it server-side
 * via /api/voice (ASR) and returns the text query.
 */
export function VoiceSearch({ onResult }: VoiceSearchProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      // Prevent onstop handler from processing an aborted recording
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    releaseStream();
    setRecording(false);
  }, [clearTimers, releaseStream]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      if (blob.size < 2000) {
        toast({
          title: "Ses çok kısa",
          description: "Lütfen tekrar deneyin ve biraz daha uzun konuşun.",
          variant: "destructive",
        });
        return;
      }
      setProcessing(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(",")[1] || "";
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64, mimeType: blob.type }),
        });
        const data = (await res.json()) as { text?: string; error?: string };
        const text = (data.text || "").trim();
        if (!res.ok || !text) {
          throw new Error(data.error || "Ses anlaşılamadı.");
        }
        setOpen(false);
        onResult(text);
      } catch (err) {
        toast({
          title: "Ses anlaşılamadı",
          description:
            err instanceof Error ? err.message : "Lütfen daha net konuşup tekrar deneyin.",
          variant: "destructive",
        });
      } finally {
        setProcessing(false);
        releaseStream();
      }
    },
    [onResult, releaseStream, toast]
  );

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        clearTimers();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        void transcribe(blob);
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 0.1), 100);
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") {
          recorderRef.current.stop();
        }
        setRecording(false);
      }, MAX_DURATION_MS);
    } catch {
      toast({
        title: "Mikrofona erişilemedi",
        description: "Tarayıcı izinlerini kontrol edip tekrar deneyin.",
        variant: "destructive",
      });
      setOpen(false);
    }
  }, [clearTimers, toast, transcribe]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    clearTimers();
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  }, [clearTimers]);

  // Cleanup on unmount
  useEffect(() => stopAll, [stopAll]);

  return (
    <>
      <button
        type="button"
        aria-label="Sesli arama"
        title="Sesli arama"
        onClick={() => setOpen(true)}
        className="rounded-full p-1.5 transition-colors hover:bg-muted"
      >
        <Mic className="size-4 text-[#EA4335] md:size-5" aria-hidden="true" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) stopAll();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sesli arama</DialogTitle>
            <DialogDescription>
              Mikrofona konuşun, aramanız otomatik olarak yazıya dökülsün.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 py-6">
            <div className="relative flex size-24 items-center justify-center">
              {recording && (
                <span className="absolute inset-0 animate-ping rounded-full bg-[#EA4335]/20" aria-hidden="true" />
              )}
              <div className="relative flex size-24 items-center justify-center rounded-full bg-[#EA4335]/10">
                <Mic className="size-10 text-[#EA4335]" aria-hidden="true" />
              </div>
            </div>

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {processing
                ? "Sesiniz metne çevriliyor..."
                : recording
                  ? `Dinliyorum... (${elapsed.toFixed(1)} sn)`
                  : "Mikrofon hazır"}
            </p>

            {processing && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />}

            {recording && (
              <Button variant="destructive" onClick={stopRecording} className="gap-2">
                <Square className="size-4" aria-hidden="true" />
                Durdur
              </Button>
            )}

            {!recording && !processing && (
              <Button onClick={() => void start()} className="gap-2">
                <Mic className="size-4" aria-hidden="true" />
                Tekrar kaydet
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
