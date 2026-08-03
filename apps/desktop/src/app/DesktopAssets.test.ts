import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const environmentLayer = DesktopEnvironment.layer({
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
}).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))));

describe("DesktopAssets", () => {
  it.effect("prefers the channel-specific development icon on Windows", () => {
    const expectedIconPath = "D:\\repo\\assets\\dev\\blueprint-windows.ico";
    const windowsEnvironmentLayer = DesktopEnvironment.layer({
      dirname: "D:\\repo\\apps\\desktop\\dist-electron",
      homeDirectory: "C:\\Users\\alice",
      platform: "win32",
      processArch: "x64",
      appVersion: "1.2.3",
      appPath: "D:\\repo",
      isPackaged: false,
      resourcesPath: "D:\\repo\\apps\\desktop\\resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({ VITE_DEV_SERVER_URL: "http://127.0.0.1:5733" }),
        ),
      ),
    );
    const fileSystemLayer = FileSystem.layerNoop({
      exists: (path) => Effect.succeed(path === expectedIconPath),
    });
    const assetsLayer = DesktopAssets.layer.pipe(
      Layer.provide(Layer.merge(fileSystemLayer, windowsEnvironmentLayer)),
    );

    return Effect.gen(function* () {
      const assets = yield* DesktopAssets.DesktopAssets;
      const iconPaths = yield* assets.iconPaths;

      assert.equal(Option.getOrUndefined(iconPaths.ico), expectedIconPath);
    }).pipe(Effect.provide(assetsLayer));
  });

  it.effect("preserves the failed asset candidate and filesystem cause", () =>
    Effect.gen(function* () {
      const fileName = "custom.bin";
      const candidatePath = "/repo/apps/desktop/resources/custom.bin";
      const cause = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "exists",
        pathOrDescriptor: candidatePath,
        description: "private filesystem diagnostic",
      });
      const fileSystemLayer = FileSystem.layerNoop({
        exists: (path) => (path === candidatePath ? Effect.fail(cause) : Effect.succeed(false)),
      });
      const assetsLayer = DesktopAssets.layer.pipe(
        Layer.provide(Layer.merge(fileSystemLayer, environmentLayer)),
      );
      const assets = yield* DesktopAssets.DesktopAssets.pipe(Effect.provide(assetsLayer));

      const error = yield* assets.resolveResourcePath(fileName).pipe(Effect.flip);

      assert.instanceOf(error, DesktopAssets.DesktopAssetProbeError);
      assert.equal(error.fileName, fileName);
      assert.equal(error.candidatePath, candidatePath);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        `Failed to probe desktop asset "${fileName}" at ${candidatePath}.`,
      );
      assert.notInclude(error.message, "private filesystem diagnostic");
    }),
  );
});
