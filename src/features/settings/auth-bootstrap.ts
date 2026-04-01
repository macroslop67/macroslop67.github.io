import { z } from "zod";
import { i18n } from "../../i18n";

const loginFlowSchema = z.object({
  type: z.string(),
});

const loginFlowsResponseSchema = z.object({
  flows: z.array(loginFlowSchema),
});

const loginSuccessResponseSchema = z.object({
  access_token: z.string().min(1),
  user_id: z.string().min(1),
  device_id: z.string().optional(),
});

const matrixErrorSchema = z.object({
  errcode: z.string().optional(),
  error: z.string().optional(),
});

const normalizeHomeserverUrl = (homeserverUrl: string): string =>
  homeserverUrl.trim().replace(/\/$/, "");

const buildLoginEndpoint = (homeserverUrl: string, clientVersion: "v3" | "r0"): string =>
  `${normalizeHomeserverUrl(homeserverUrl)}/_matrix/client/${clientVersion}/login`;

const readErrorResponseMessage = async (response: Response): Promise<string> => {
  try {
    const parsed = matrixErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      const errcode = parsed.data.errcode;
      const errorText = parsed.data.error;
      if (errcode && errorText) {
        return `${errcode}: ${errorText}`;
      }

      if (errorText) {
        return errorText;
      }
    }
  } catch {
    // Ignore response body parse errors and return fallback text below.
  }

  return `Request failed with HTTP ${response.status}`;
};

const fetchLoginFlows = async (
  homeserverUrl: string,
): Promise<{ clientVersion: "v3" | "r0"; flowTypes: string[] }> => {
  const versions: Array<"v3" | "r0"> = ["v3", "r0"];
  let lastFailureMessage = "Homeserver login endpoint is not reachable.";

  for (const clientVersion of versions) {
    const endpoint = buildLoginEndpoint(homeserverUrl, clientVersion);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      lastFailureMessage = await readErrorResponseMessage(response);
      continue;
    }

    const parsedBody = loginFlowsResponseSchema.safeParse(await response.json());
    if (!parsedBody.success) {
      throw new Error(i18n.t("settings.invalidLoginFlows"));
    }

    return {
      clientVersion,
      flowTypes: parsedBody.data.flows.map((flow) => flow.type),
    };
  }

  throw new Error(lastFailureMessage);
};

export interface AuthBootstrapRequest {
  homeserverUrl: string;
  user: string;
  password: string;
  deviceDisplayName?: string;
}

export interface AuthBootstrapResult {
  accessToken: string;
  userId: string;
  deviceId: string | null;
}

export const acquireTokenWithPassword = async (
  request: AuthBootstrapRequest,
): Promise<AuthBootstrapResult> => {
  const homeserverUrl = normalizeHomeserverUrl(request.homeserverUrl);
  const user = request.user.trim();
  const password = request.password;

  if (!homeserverUrl) {
    throw new Error(i18n.t("settings.homeserverRequired"));
  }

  if (!user) {
    throw new Error(i18n.t("settings.userRequired"));
  }

  if (!password) {
    throw new Error(i18n.t("settings.passwordRequired"));
  }

  const { clientVersion, flowTypes } = await fetchLoginFlows(homeserverUrl);
  if (!flowTypes.includes("m.login.password")) {
    throw new Error(i18n.t("settings.noPasswordFlow"));
  }

  const response = await fetch(buildLoginEndpoint(homeserverUrl, clientVersion), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user,
      },
      password,
      initial_device_display_name: request.deviceDisplayName?.trim() || "MatricesBB",
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorResponseMessage(response));
  }

  const parsedBody = loginSuccessResponseSchema.safeParse(await response.json());
  if (!parsedBody.success) {
    throw new Error(i18n.t("settings.invalidLoginResponse"));
  }

  return {
    accessToken: parsedBody.data.access_token,
    userId: parsedBody.data.user_id,
    deviceId: parsedBody.data.device_id ?? null,
  };
};
