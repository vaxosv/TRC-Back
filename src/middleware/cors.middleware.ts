import type {Request, Response} from "express";
import {ALLOWED_ORIGINS} from "../config";

export function withCors(req: Request, res: Response, allowOrigins = ALLOWED_ORIGINS): void {
  const origin = req.headers.origin;

  if (origin && allowOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
}
