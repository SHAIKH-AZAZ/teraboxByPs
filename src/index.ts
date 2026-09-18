import { tera } from "./lib/terabox";
import { isValidShareUrl, extractSurl, formatBytes, loadCookies } from "./lib/utils";
import { file } from "bun";
import { join } from "path";

const port = process.env.PORT || 5000;

const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_DURATION = 2 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

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

    if (pathname === "/api") {
      try {
        const startTime = Date.now();
        const targetUrlRaw = url.searchParams.get("url");

        if (!targetUrlRaw || !targetUrlRaw.trim()) {
          return Response.json(
            {
              status: "error",
              message: "Missing required parameter: url",
              example: "/api?url=https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g",
            },
            { status: 400, headers: corsHeaders },
          );
        }

        const targetUrl = targetUrlRaw.trim();

        if (!targetUrl.startsWith("http") || !isValidShareUrl(targetUrl)) {
          return Response.json(
            {
              status: "error",
              url: targetUrl,
              message: "Invalid TeraBox share URL",
            },
            { status: 400, headers: corsHeaders },
          );
        }

        const surl = extractSurl(targetUrl);
        if (!surl) {
          return Response.json(
            {
              status: "error",
              url: targetUrl,
              message: "Could not extract surl from URL",
            },
            { status: 400, headers: corsHeaders },
          );
        }

        let data;
        const cached = cache.get(surl);
        if (cached && Date.now() < cached.expiry) {
          data = cached.data;
        } else {
          data = await tera(surl);
          cache.set(surl, { data, expiry: Date.now() + CACHE_DURATION });
        }
        const responseTime = ((Date.now() - startTime) / 1000).toFixed(3) + "s";

        if (data && data.error) {
          return Response.json(
            {
              status: "error",
              url: targetUrl,
              surl: surl,
              error: data.error,
              response_time: responseTime,
              timestamp: new Date().toISOString(),
            },
            { status: 400, headers: corsHeaders },
          );
        }

        let filename;
        let size;
        let download;
        let thumbs;

        if (data && data.list && data.list.length > 0) {
          const firstItem = data.list[0];
          filename = firstItem.server_filename;
          size = formatBytes(firstItem.size);
          download = firstItem.dlink;
          thumbs = firstItem.thumbs;
        }

        return Response.json(
          {
            status: "success",
            response_time: responseTime,
            url: targetUrl,
            ...(filename && { filename }),
            ...(size && { size }),
            ...(download && { download }),
            ...(thumbs && { thumbs }),
          },
          { headers: corsHeaders },
        );
      } catch (error: any) {
        return Response.json(
          {
            status: "error",
            message: String(error),
            url: url.searchParams.get("url"),
          },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    if (pathname === "/stream") {
      const targetUrlRaw = url.searchParams.get("url");
      if (!targetUrlRaw) {
        return Response.json(
          { status: "error", message: "Missing required parameter: url" },
          { status: 400, headers: corsHeaders },
        );
      }

      try {
        const cookies = loadCookies();
        const cookieString = cookies["ndus"] ? `ndus=${cookies["ndus"]}` : "";

        const upstream = await fetch(targetUrlRaw, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
            Referer: "https://dm.terabox.app/",
            Origin: "https://dm.terabox.app",
            ...(cookieString && { Cookie: cookieString }),
            ...(req.headers.get("range") && { Range: req.headers.get("range")! }),
            ...(req.headers.get("if-range") && { "If-Range": req.headers.get("if-range")! }),
          },
          redirect: "follow",
        });

        if (!upstream.ok && upstream.status !== 206) {
          return Response.json(
            { status: "error", message: `Upstream returned ${upstream.status}` },
            { status: 502, headers: corsHeaders },
          );
        }

        const responseHeaders: Record<string, string> = {
          ...corsHeaders,
          "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "Accept-Ranges": "bytes",
        };
        const cl = upstream.headers.get("content-length");
        if (cl) responseHeaders["Content-Length"] = cl;
        const cr = upstream.headers.get("content-range");
        if (cr) responseHeaders["Content-Range"] = cr;
        const ar = upstream.headers.get("accept-ranges");
        if (ar) responseHeaders["Accept-Ranges"] = ar;

        return new Response(upstream.body, {
          status: upstream.status,
          headers: responseHeaders,
        });
      } catch (err) {
        return Response.json(
          { status: "error", message: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    return Response.json(
      { error: "Not Found" },
      { status: 404, headers: corsHeaders },
    );
  },
});
