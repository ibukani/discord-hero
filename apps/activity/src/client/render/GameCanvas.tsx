import { useEffect, useRef, type JSX } from "react";
import { type AnimatedSprite, Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { GAME_VISUAL_ASSET_IDS } from "@discord-hero/assets";
import type { GameSnapshot } from "@discord-hero/protocol";
import { GameAssetLibrary } from "../assets/GameAssetLibrary.js";

export interface GameCanvasProps {
  readonly snapshot: GameSnapshot | null;
  readonly currentPlayerId: string | null;
}

export function GameCanvas({ snapshot, currentPlayerId }: GameCanvasProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const applicationRef = useRef<Application | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(snapshot);
  const currentPlayerIdRef = useRef<string | null>(currentPlayerId);
  const assetLibraryRef = useRef<GameAssetLibrary | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
    currentPlayerIdRef.current = currentPlayerId;
  }, [snapshot, currentPlayerId]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const application = new Application();
    let disposed = false;
    let initialized = false;
    void application
      .init({
        resizeTo: host,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
      })
      .then(() => {
        initialized = true;
        if (disposed) {
          application.destroy(true, { children: true });
          return;
        }
        host.appendChild(application.canvas);
        applicationRef.current = application;
        drawScene(
          application,
          snapshotRef.current,
          currentPlayerIdRef.current,
          assetLibraryRef.current,
        );
        return GameAssetLibrary.load();
      })
      .then((assetLibrary) => {
        if (assetLibrary === undefined || disposed || applicationRef.current !== application) {
          return;
        }
        assetLibraryRef.current = assetLibrary;
        drawScene(application, snapshotRef.current, currentPlayerIdRef.current, assetLibrary);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error("PixiJS initialization failed", error);
        }
      });

    return () => {
      disposed = true;
      if (applicationRef.current === application) {
        applicationRef.current = null;
      }
      assetLibraryRef.current = null;
      if (initialized) {
        application.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    const application = applicationRef.current;
    if (application !== null) {
      drawScene(application, snapshot, currentPlayerId, assetLibraryRef.current);
    }
  }, [snapshot, currentPlayerId]);

  return <div className="game-canvas" ref={hostRef} aria-label="戦闘フィールド" />;
}

function drawScene(
  application: Application,
  snapshot: GameSnapshot | null,
  currentPlayerId: string | null,
  assetLibrary: GameAssetLibrary | null,
): void {
  const removed = application.stage.removeChildren();
  for (const child of removed) {
    child.destroy({ children: true });
  }

  const width = Math.max(application.renderer.width / application.renderer.resolution, 320);
  const height = Math.max(application.renderer.height / application.renderer.resolution, 180);

  // Pixel Art Stage Background
  const background = new Graphics()
    .rect(0, 0, width, height)
    .fill({ color: 0x3d6072 })
    .poly([
      0,
      height * 0.68,
      width * 0.18,
      height * 0.46,
      width * 0.36,
      height * 0.68,
      width * 0.58,
      height * 0.42,
      width * 0.84,
      height * 0.68,
      width,
      height * 0.5,
      width,
      height,
      0,
      height,
    ])
    .fill({ color: 0x4b6f73 })
    .rect(0, height * 0.72, width, height * 0.28)
    .fill({ color: 0x52785f })
    .rect(0, height * 0.72 - 4, width, 4)
    .fill({ color: 0xa4c27c })
    .rect(0, height * 0.72, width, 2)
    .fill({ color: 0x315b61 });
  application.stage.addChild(background);

  if (snapshot === null) {
    application.stage.addChild(
      createText("ルームへ接続しています…", width / 2, height / 2, 16, 0xffcf40, 0.5),
    );
    return;
  }

  const players = Object.values(snapshot.players);
  const enemies = Object.values(snapshot.enemies);
  const playerLayer = new Container();
  const enemyLayer = new Container();

  const playerSpacing = Math.min(86, Math.max(58, (width * 0.42) / Math.max(players.length, 1)));
  players.forEach((player, index) => {
    const x = 48 + index * playerSpacing;
    const y = height * 0.58;
    const isCurrent = player.id === currentPlayerId;
    const active = !player.downed && !player.eliminated && player.hp > 0;
    playerLayer.addChild(createGroundShadow(x, y + 17, isCurrent ? 24 : 21));
    const body = createPlayerVisual(assetLibrary, player.classId, isCurrent, active);
    body.position.set(x, y);
    playerLayer.addChild(body);

    const nameColor = isCurrent ? 0xffcf40 : 0xe8f0f7;
    const name = createText(player.displayName, x, y + 32, 11, nameColor, 0.5);
    playerLayer.addChild(name);
    playerLayer.addChild(
      createHealthBar(
        x - 26,
        y - 36,
        52,
        player.hp,
        player.maxHp,
        player.downed || player.eliminated ? 0xf59e0b : 0x4ade80,
      ),
    );
    if (player.downed || player.eliminated) {
      playerLayer.addChild(
        createText(player.eliminated ? "OUT" : "DOWN", x, y - 52, 9, 0xfbbf24, 0.5),
      );
    } else if (player.rescueTargetId !== null) {
      playerLayer.addChild(createText("RESCUE", x, y - 52, 8, 0x60a5fa, 0.5));
    }
    if (player.shield > 0) {
      playerLayer.addChild(createText(`🛡 ${player.shield}`, x, y - 50, 10, 0x60a5fa, 0.5));
    }
  });

  const enemySpacing = Math.min(76, Math.max(48, (width * 0.42) / Math.max(enemies.length, 1)));
  enemies.forEach((enemy, index) => {
    const x = width - 48 - index * enemySpacing;
    const y = height * 0.58;
    enemyLayer.addChild(createGroundShadow(x, y + 17, enemy.boss ? 30 : 20));
    const body = createEnemyVisual(assetLibrary, enemy.boss);
    body.position.set(x, y);
    enemyLayer.addChild(body);
    enemyLayer.addChild(createHealthBar(x - 26, y - 38, 52, enemy.hp, enemy.maxHp, 0xf87171));
  });

  application.stage.addChild(playerLayer, enemyLayer);

  // Top Status Bar Badge
  const headerBadge = new Graphics()
    .rect(12, 10, 180, 24)
    .fill({ color: 0x355b6b })
    .stroke({ width: 2, color: 0xa5c581 });
  application.stage.addChild(headerBadge);
  application.stage.addChild(
    createText(
      `⚔ ${statusLabel(snapshot.status)}  Wave ${Math.max(snapshot.waveIndex, 1)}`,
      20,
      22,
      12,
      0xffcf40,
      0,
    ),
  );

  const timerBadge = new Graphics()
    .rect(width - 84, 10, 72, 24)
    .fill({ color: 0x355b6b })
    .stroke({ width: 2, color: 0xa5c581 });
  application.stage.addChild(timerBadge);
  application.stage.addChild(
    createText(formatDuration(snapshot.elapsedMs), width - 48, 22, 12, 0xe6eef8, 0.5),
  );
}

function createPlayerVisual(
  assetLibrary: GameAssetLibrary | null,
  classId: GameSnapshot["players"][string]["classId"],
  isCurrent: boolean,
  alive: boolean,
): AnimatedSprite | Graphics {
  const sprite = assetLibrary?.createAnimatedSprite(GAME_VISUAL_ASSET_IDS.soldierIdle) ?? null;
  if (sprite !== null) {
    sprite.scale.set(isCurrent ? 2.05 : 1.85);
    sprite.tint = classColor(classId);
    sprite.alpha = alive ? 1 : 0.35;
    return sprite;
  }
  return new Graphics()
    .circle(0, 0, isCurrent ? 20 : 17)
    .fill({ color: classColor(classId), alpha: alive ? 1 : 0.35 });
}

function createEnemyVisual(
  assetLibrary: GameAssetLibrary | null,
  boss: boolean,
): AnimatedSprite | Graphics {
  const sprite = assetLibrary?.createAnimatedSprite(GAME_VISUAL_ASSET_IDS.orcIdle) ?? null;
  if (sprite !== null) {
    sprite.scale.set(boss ? 2.6 : 1.9);
    sprite.tint = boss ? 0xd98691 : 0xffffff;
    return sprite;
  }
  return new Graphics().circle(0, 0, boss ? 27 : 16).fill({ color: boss ? 0xd85f70 : 0xe39b55 });
}

function createHealthBar(
  x: number,
  y: number,
  width: number,
  current: number,
  maximum: number,
  color: number,
): Container {
  const container = new Container();
  const ratio = maximum <= 0 ? 0 : Math.max(0, Math.min(1, current / maximum));
  const innerWidth = Math.max(0, (width - 4) * ratio);

  container.addChild(
    // Pixel frame background
    new Graphics()
      .rect(x, y, width, 8)
      .fill({ color: 0x203747 })
      .stroke({ width: 1, color: 0xb4ce9b }),
    // Filled bar
    new Graphics().rect(x + 2, y + 2, innerWidth, 4).fill({ color }),
  );
  return container;
}

function createGroundShadow(x: number, y: number, radius: number): Graphics {
  return new Graphics().ellipse(x, y, radius, 5).fill({ color: 0x274c50, alpha: 0.48 });
}

function createText(
  value: string,
  x: number,
  y: number,
  size: number,
  color: number,
  anchorX: number,
): Text {
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: color,
      fontFamily: '"DotGothic16", "Press Start 2P", monospace',
      fontSize: size,
      fontWeight: "bold",
    }),
  });
  text.anchor.set(anchorX, 0.5);
  text.position.set(x, y);
  return text;
}

function classColor(classId: GameSnapshot["players"][string]["classId"]): number {
  switch (classId) {
    case "guardian":
      return 0x6da7e8;
    case "ranger":
      return 0x7fd28d;
    case "mage":
      return 0xb287e8;
    case "support":
      return 0xe8ca70;
  }
}

function statusLabel(status: GameSnapshot["status"]): string {
  switch (status) {
    case "lobby":
      return "ロビー";
    case "running":
      return "遠征中";
    case "victory":
      return "勝利";
    case "defeat":
      return "敗北";
    case "return":
      return "帰還";
  }
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
