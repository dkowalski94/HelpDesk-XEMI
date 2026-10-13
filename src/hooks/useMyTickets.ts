import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketListResponse, TicketSummary } from "@/types";

export type MyTicketsState =
  { status: "loading" } | { status: "ok"; tickets: TicketSummary[] } | { status: "error"; error: string };

async function fetchMyTickets(): Promise<MyTicketsState> {
  try {
    const response = await fetch("/api/tickets?mine=1");
    const payload = (await response.json()) as TicketListResponse;
    return payload.ok
      ? { status: "ok", tickets: payload.tickets }
      : { status: "error", error: "Nie udało się wczytać Twoich zgłoszeń." };
  } catch {
    return { status: "error", error: "Nie udało się połączyć z serwerem, aby wczytać Twoje zgłoszenia." };
  }
}

/**
 * The caller's own tickets (`GET /api/tickets?mine=1`), first page only. `reload()`
 * refetches after the panel files or finds a ticket. A response that arrives after a
 * newer request was started is dropped, so a slow first load cannot overwrite a reload.
 */
export function useMyTickets() {
  const [state, setState] = useState<MyTicketsState>({ status: "loading" });
  const latestRequest = useRef(0);

  const reload = useCallback(() => {
    const requestId = ++latestRequest.current;
    void fetchMyTickets().then((next) => {
      if (requestId === latestRequest.current) setState(next);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { state, reload };
}
