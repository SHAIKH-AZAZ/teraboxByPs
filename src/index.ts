import { file } from "bun";
import { join } from "path";
import { apiHandler, streamHandler, corsHeaders } from "./handlers";

const port = process.env.PORT || 5000;

Bun.serve({
  port,
  async fetch(req) {
    const pathname = new URL(req.url).pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (pathname === "/api-info") {
      return Response.json(
        {
          name: "TeraBox API",
          version: "3.0",
          status: "operational",
          endpoints: {
            "/": "Web UI",
            "/api": "Fetch files from Terabox link",
          },
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders },
      );
    }

    if (pathname === "/") {
      return new Response(file(join(import.meta.dir, "..", "public", "index.html")), {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (pathname === "/api") return apiHandler(req);
    if (pathname === "/stream") return streamHandler(req);

    return Response.json(
      { error: "Not Found" },
      { status: 404, headers: corsHeaders },
    );
  },
});

console.log(`TeraBox ready on http://localhost:${port}`);
