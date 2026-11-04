import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z, ZodError } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { MetaNotConfigured } from "./meta.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const route =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_error", issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof MetaNotConfigured) return res.status(503).json({ error: err.message });
  const e = err as { status?: number; message?: string };
  // Upstream Meta API errors carry a status; never echo headers (they contain the key).
  if (typeof e?.status === "number") {
    console.error("[meta]", e.status, e.message);
    return res.status(502).json({ error: "model_api_error", upstreamStatus: e.status, message: e.message });
  }
  console.error(err);
  res.status(500).json({ error: "internal_error", message: e?.message });
}

export const DeviceId = z.string().trim().min(4).max(128).regex(/^[A-Za-z0-9._:-]+$/);

/** Anonymous device id from header, body or query. */
export function deviceIdOf(req: Request): string {
  const raw = req.header("x-device-id") ?? (req.body as Record<string, unknown> | undefined)?.deviceId ?? req.query.deviceId;
  const r = DeviceId.safeParse(raw);
  if (!r.success) throw new HttpError(400, "deviceId required (x-device-id header, body.deviceId or ?deviceId=)");
  return r.data;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Accept an image either as multipart field `image` (multer memory storage)
 * or JSON `imageBase64` (raw base64 or data URL) + optional `mimeType`.
 * Saves it under media/uploads and returns a data URL for the model + public path.
 */
export function readImage(req: Request): { dataUrl: string; publicUrl: string; bytes: number } {
  let buf: Buffer | undefined;
  let mime = "image/jpeg";
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file) {
    buf = file.buffer;
    mime = file.mimetype;
  } else {
    const b = (req.body ?? {}) as { imageBase64?: string; mimeType?: string };
    if (typeof b.imageBase64 === "string" && b.imageBase64.length > 0) {
      const m = b.imageBase64.match(/^data:([^;]+);base64,(.*)$/s);
      if (m) {
        mime = m[1];
        buf = Buffer.from(m[2], "base64");
      } else {
        mime = b.mimeType ?? "image/jpeg";
        buf = Buffer.from(b.imageBase64, "base64");
      }
    }
  }
  if (!buf || buf.length === 0) throw new HttpError(400, "image required: multipart field 'image' or JSON 'imageBase64'");
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, "image too large (max 8 MB)");
  if (!ALLOWED.has(mime)) throw new HttpError(415, `unsupported image type ${mime}`);
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(config.mediaDir, "uploads", name), buf);
  return { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, publicUrl: `/media/uploads/${name}`, bytes: buf.length };
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
