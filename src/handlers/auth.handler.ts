import type {Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {ValidationError} from "../errors";
import {toMessage} from "../utils";
import {dbService} from "../services/database.service";
import {stravaService} from "../services/strava.service";

export interface Secrets {
  clientId: string;
  clientSecret: string;
}

export class AuthHandler {
  async exchangeToken(req: Request, res: Response, secrets: Secrets): Promise<void> {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";

      if (!code) {
        throw new ValidationError("Missing Strava authorization code");
      }

      const tokenData = await stravaService.exchangeAuthCode(
        code,
        secrets.clientId,
        secrets.clientSecret
      );

      const athlete = await stravaService.getAthleteByAccessToken(tokenData.accessToken);
      const athleteId = athlete.id;

      const uid = (res.locals as Record<string, unknown>).uid as string;

      await dbService.linkUserWithStravaAuth({
        uid,
        athleteId,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        tokenType: tokenData.tokenType,
      });

      res.status(200).json({athleteId});
    } catch (error) {
      logger.error("Error in exchangeStravaToken", {
        error: toMessage(error),
      });
      if (error instanceof ValidationError) {
        res.status(400).json({error: error.message});
        return;
      }
      res.status(500).json({error: "Internal server error", message: toMessage(error)});
    }
  }
}

export const authHandler = new AuthHandler();
