"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { WorkerSnapshot } from "@/lib/queries/worker";

/** Poll quickly while the worker has work, slowly otherwise. */
const BUSY_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

const WorkerStatusContext = createContext<WorkerSnapshot | null>(null);

/**
 * What would change on a server-rendered page: a run starting or finishing, the queue, pausing,
 * or the worker going on/offline. Progress ticks are left out so pages aren't re-rendered
 * constantly.
 */
function pageSignature(snapshot: WorkerSnapshot) {
  return JSON.stringify([
    snapshot.finishedKey,
    snapshot.active.map((run) => `${run.id}:${run.status}`),
    snapshot.queued.map((job) => job.jobId),
    snapshot.worker?.online ?? false,
    snapshot.paused,
  ]);
}

/**
 * Keeps one live copy of the worker's state for the header indicator and the Worker page (both
 * admins only).
 */
export function WorkerStatusProvider({
  initial,
  children,
}: {
  initial: WorkerSnapshot;
  children: ReactNode;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const signature = useRef(pageSignature(initial));

  // A server render (navigation, router.refresh) brings a newer snapshot.
  useEffect(() => {
    setSnapshot(initial);
    signature.current = pageSignature(initial);
  }, [initial]);

  const busy = snapshot.busy;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/worker", { cache: "no-store" });
          // Signed out (the session expired), or no longer an admin: the server renders the page
          // without the worker (or sends it to sign-in).
          if (response.status === 401 || response.status === 403) {
            router.refresh();
            return;
          }
          if (response.ok && !stopped) {
            const next = (await response.json()) as WorkerSnapshot;
            setSnapshot(next);
            const nextSignature = pageSignature(next);
            if (nextSignature !== signature.current) {
              signature.current = nextSignature;
              router.refresh();
            }
          }
        } catch {
          // Offline or restarting: try again on the next tick.
        }
      }
      if (!stopped) timer = setTimeout(poll, busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    };
    timer = setTimeout(poll, busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [busy, router]);

  return <WorkerStatusContext.Provider value={snapshot}>{children}</WorkerStatusContext.Provider>;
}

export function useWorkerStatus(): WorkerSnapshot {
  const snapshot = useContext(WorkerStatusContext);
  if (!snapshot) throw new Error("useWorkerStatus must be used within <WorkerStatusProvider>");
  return snapshot;
}
