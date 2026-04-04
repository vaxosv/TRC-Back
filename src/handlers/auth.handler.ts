import type {Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {ValidationError} from "../errors";
import {toMessage} from "../utils";
import {dbService} from "../services/database.service";
import {stravaService} from "../services/strava.service";
import {
  STRAVA_CLIENT_ID_SECRET,
  STRAVA_CLIENT_SECRET_SECRET,
} from "../config";

export class AuthHandler {
  async exchangeToken(req: Request, res: Response): Promise<void> {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";

      if (!code) {
        throw new ValidationError("Missing Strava authorization code");
      }

      const tokenData = await stravaService.exchangeAuthCode(
        code,
        STRAVA_CLIENT_ID_SECRET.value(),
        STRAVA_CLIENT_SECRET_SECRET.value()
      );

      const athlete = await stravaService.getAthleteByAccessToken(tokenData.accessToken);
      const athleteId = athlete.id;

      await dbService.linkUserWithStravaAuth({
        uid: res.locals.uid,
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
