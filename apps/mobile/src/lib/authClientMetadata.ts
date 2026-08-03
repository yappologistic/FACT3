import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { Platform } from "react-native";

export function authClientMetadata(): AuthClientPresentationMetadata {
  return {
    label: "FACT3 Code Mobile",
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
  };
}
