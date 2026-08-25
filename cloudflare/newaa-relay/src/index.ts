import { DurableObject } from "cloudflare:workers";

type SocketRole = "pending" | "client" | "bot";
type Attachment = { role: SocketRole; windowStart: number; commandCount: number };
type AuthMessage = { type?: unknown; token?: unknown; role?: unknown };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function bearer(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function sameSecret(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < x.length; index += 1) difference |= x[index] ^ y[index];
  return difference === 0;
}

export class MusicRoom extends DurableObject<Env> {
  private latestState = "";

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket requis", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "pending", windowStart: Date.now(), commandCount: 0 } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 262_144) {
      socket.close(1009, "Message trop volumineux");
      return;
    }
    const attachment = (socket.deserializeAttachment() || { role: "pending", windowStart: Date.now(), commandCount: 0 }) as Attachment;
    let message: AuthMessage;
    try {
      message = JSON.parse(raw) as AuthMessage;
    } catch {
      socket.close(1003, "JSON invalide");
      return;
    }

    if (attachment.role === "pending") {
      if (message.type !== "auth" || typeof message.token !== "string" || !(await sameSecret(message.token, this.env.ACCESS_TOKEN))) {
        socket.close(4001, "Authentification refusée");
        return;
      }
      const role: SocketRole = message.role === "bot" ? "bot" : "client";
      if (role === "bot") {
        for (const other of this.ctx.getWebSockets()) {
          const otherAttachment = other.deserializeAttachment() as Attachment | null;
          if (other !== socket && otherAttachment?.role === "bot") other.close(4002, "Nouvelle connexion du bot");
        }
      }
      socket.serializeAttachment({ role, windowStart: Date.now(), commandCount: 0 } satisfies Attachment);
      socket.send(JSON.stringify({ type: "event", event: "authenticated", payload: { ok: true, role } }));
      if (role === "client" && this.latestState) socket.send(this.latestState);
      return;
    }

    if (attachment.role === "bot") {
      if (message.type === "state") this.latestState = raw;
      for (const target of this.ctx.getWebSockets()) {
        const targetAttachment = target.deserializeAttachment() as Attachment | null;
        if (targetAttachment?.role === "client") target.send(raw);
      }
      return;
    }

    const now = Date.now();
    if (now - attachment.windowStart >= 1_000) {
      attachment.windowStart = now;
      attachment.commandCount = 0;
    }
    attachment.commandCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.commandCount > 12) {
      socket.send(JSON.stringify({ type: "event", event: "command_result", payload: { ok: false, message: "Trop de commandes envoyées." } }));
      return;
    }
    const bot = this.ctx.getWebSockets().find((candidate) => (candidate.deserializeAttachment() as Attachment | null)?.role === "bot");
    if (!bot) {
      socket.send(JSON.stringify({ type: "event", event: "command_result", payload: { ok: false, message: "Le bot Inazuma Music n’est pas démarré sur le PC principal." } }));
      return;
    }
    bot.send(raw);
  }

  webSocketClose(): void {}
  webSocketError(): void {}
}

async function youtubeSearch(request: Request, env: Env): Promise<Response> {
  if (!(await sameSecret(bearer(request), env.ACCESS_TOKEN))) return json({ error: "Accès refusé" }, 401);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 160);
  const pageToken = (url.searchParams.get("pageToken") || "").slice(0, 200);
  if (!query) return json({ error: "Recherche vide" }, 400);
  const searchParams = new URLSearchParams({ part: "snippet", type: "video", maxResults: "18", q: query, key: env.YOUTUBE_API_KEY });
  if (pageToken) searchParams.set("pageToken", pageToken);
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  if (!searchResponse.ok) return json({ error: "La recherche YouTube est momentanément indisponible." }, 502);
  const searchData = await searchResponse.json<{
    nextPageToken?: string;
    items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { high?: { url: string }; medium?: { url: string } } } }>;
  }>();
  const items = searchData.items || [];
  const ids = items.map((item) => item.id.videoId).filter(Boolean).join(",");
  const durations = new Map<string, string>();
  if (ids) {
    const detailsParams = new URLSearchParams({ part: "contentDetails", id: ids, key: env.YOUTUBE_API_KEY });
    const detailsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
    if (detailsResponse.ok) {
      const detailsData = await detailsResponse.json<{ items?: Array<{ id: string; contentDetails: { duration: string } }> }>();
      for (const item of detailsData.items || []) durations.set(item.id, item.contentDetails.duration);
    }
  }
  return json({
    nextPageToken: searchData.nextPageToken || "",
    items: items.map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || "",
      duration: durations.get(item.id.videoId) || "",
    })),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "NEWAA Music" });
    if (url.pathname === "/youtube/search" && request.method === "GET") return youtubeSearch(request, env);
    if (url.pathname === "/ws") return env.MUSIC_ROOM.getByName("newaa-main").fetch(request);
    return new Response("Introuvable", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
