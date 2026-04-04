import * as admin from "firebase-admin";
import type {Request} from "express";
import {ValidationError} from "../errors";
import {toMessage} from "../utils";

admin.initializeApp();

export interface DecodedToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  user_id?: string;
  [key: string]: unknown;
}

export async function verifyFirebaseToken(req: Request): Promise<DecodedToken> {
  const authHeader = req.header("Authorization") || "";
  const bearerPrefix = "Bearer ";

  if (!authHeader.startsWith(bearerPrefix)) {
    throw new ValidationError("Missing or invalid Authorization header");
  }

  const idToken = authHeader.slice(bearerPrefix.length).trim();

  if (!idToken) {
    throw new ValidationError("Missing or invalid Authorization header");
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded as DecodedToken;
  } catch (error) {
    throw new ValidationError(`Invalid ID token: ${toMessage(error)}`);
  }
}
