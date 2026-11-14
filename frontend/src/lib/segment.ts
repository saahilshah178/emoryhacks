// Playing one stretch of a video: jump to its start, play, and pause at its end.
// Pressing play afterwards carries on from there. If the viewer drags the playhead out
// of the stretch, the pending stop is dropped and the video just keeps playing.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasSpan } from "./format";

const armedStops = new WeakMap<HTMLVideoElement, () => void>();
// Stop this long before the end, so the playhead rests inside the stretch just played
// rather than on the first frame of the next one.
export const STOP_LEAD_S = 0.05;

export function cancelSegment(video: HTMLVideoElement) {
  armedStops.get(video)?.();
}

export function playSegment(video: HTMLVideoElement, start: number, end?: number | null) {
  cancelSegment(video);
  const from = Math.max(0, Number(start) || 0);
  video.currentTime = from;
  if (hasSpan(from, end)) {
    const to = Number(end);
    const stopAt = Math.max(from, to - STOP_LEAD_S);
    let frame = 0;
    let ownSeek = true; // the seek above is ours, not the viewer scrubbing
    const listeners: Array<[keyof HTMLMediaElementEventMap, () => void]> = [];
    const disarm = () => {
      cancelAnimationFrame(frame);
      for (const [name, fn] of listeners) video.removeEventListener(name, fn);
      armedStops.delete(video);
    };
    const reached = () => {
      if (video.currentTime < stopAt) return false;
      disarm();
      video.pause();
      return true;
    };
    const watch = () => {
      if (!reached() && !video.paused) frame = requestAnimationFrame(watch);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(watch);
    };
    const scrubbed = () => {
      if (ownSeek) {
        ownSeek = false;
        return;
      }
      if (video.currentTime < from - 0.25 || video.currentTime >= to) disarm();
    };
    listeners.push(["timeupdate", reached], ["play", restart], ["seeking", scrubbed], ["emptied", disarm]);
    for (const [name, fn] of listeners) video.addEventListener(name, fn);
    armedStops.set(video, disarm);
    restart(); // already playing means no "play" event will come to start the per-frame check
  }
  void video.play().catch(() => {
    /* autoplay can be refused; the seek still happened */
  });
}

/**
 * Drive a <video> from time chips and timelines.
 *
 *   const player = useVideoSegments();
 *   <VideoFrame video={attempt.video} videoRef={player.ref} />
 *   <TimeChip start={step.start_s} end={step.end_s} onPlay={player.play} />
 *
 * `time` follows the playhead (a few updates a second while playing) for highlighting the
 * current step. play(start, end) plays one stretch and stops; seek(t) just moves the playhead.
 */
export function useVideoSegments() {
  // A callback ref, so listeners attach whenever the <video> actually mounts. The element
  // is kept in state (to re-run the effect) and in a ref (to drive it from callbacks).
  const element = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const ref = useCallback((node: HTMLVideoElement | null) => {
    element.current = node;
    setVideo(node);
  }, []);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!video) return;
    const onTime = () => setTime(video.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const events: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ["timeupdate", onTime],
      ["seeked", onTime],
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onPause],
    ];
    for (const [name, fn] of events) video.addEventListener(name, fn);
    return () => {
      cancelSegment(video);
      for (const [name, fn] of events) video.removeEventListener(name, fn);
    };
  }, [video]);

  const play = useCallback((start: number, end?: number | null) => {
    const node = element.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    playSegment(node, start, end);
  }, []);

  const seek = useCallback((seconds: number) => {
    const node = element.current;
    if (!node) return;
    cancelSegment(node);
    node.currentTime = Math.max(0, seconds);
  }, []);

  // The playhead once the video has been started or moved; null before, so a bar shows no
  // position and no step counts as current until the viewer does something.
  const playhead = playing || time > 0 ? time : null;

  return { ref, video, time, playhead, playing, play, seek };
}
