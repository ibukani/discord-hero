import { DEFAULT_CONTENT } from "@discord-hero/content";
import { HERO_CLASS_IDS } from "@discord-hero/game-core";
import type { HeroClassIdDto } from "@discord-hero/protocol";
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, type JSX } from "react";
import { RoomSocket } from "./network/RoomSocket.js";
import { createPlatformBridge, type PlatformBridge } from "./platform/index.js";
import { appReducer, INITIAL_APP_STATE } from "./state/app-state.js";

const GameCanvas = lazy(async () => {
  const module = await import("./render/GameCanvas.js");
  return { default: module.GameCanvas };
});

const CLASS_LABELS: Readonly<Record<HeroClassIdDto, string>> = {
  guardian: "ガーディアン",
  ranger: "レンジャー",
  mage: "メイジ",
  support: "サポーター",
};

const UPGRADE_LABELS: Readonly<Record<string, string>> = {
  "power.training": "攻撃力を20%強化",
  "vitality.training": "最大HPを30増加",
  "tempo.training": "スキル再使用を15%短縮",
  "team.restoration": "回復量を30%強化",
};

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, INITIAL_APP_STATE);
  const socketRef = useRef<RoomSocket | null>(null);
  const platformRef = useRef<PlatformBridge | null>(null);

  useEffect(() => {
    let disposed = false;
    const platform = createPlatformBridge();
    platformRef.current = platform;

    void platform
      .initialize()
      .then(async (session) => {
        if (disposed) {
          return;
        }
        dispatch({ type: "platform_ready", session });
        const socket = new RoomSocket(session, {
          onStatus: (status) => {
            dispatch({ type: "connection_changed", status });
          },
          onMessage: (message) => {
            dispatch({ type: "server_message", message });
          },
          onError: (message) => {
            dispatch({ type: "error", message });
          },
        });
        socketRef.current = socket;
        await socket.connect();
      })
      .catch((error: unknown) => {
        if (!disposed) {
          dispatch({ type: "error", message: errorMessage(error) });
        }
      });

    return () => {
      disposed = true;
      socketRef.current?.close();
      socketRef.current = null;
      platform.dispose();
      platformRef.current = null;
    };
  }, []);

  const currentPlayer = useMemo(() => {
    if (state.snapshot === null || state.playerId === null) {
      return null;
    }
    return state.snapshot.players[state.playerId] ?? null;
  }, [state.playerId, state.snapshot]);

  const classDefinition =
    currentPlayer === null ? null : DEFAULT_CONTENT.classes[currentPlayer.classId];
  const canEditLobby = state.snapshot?.status === "lobby";
  const allReady =
    state.snapshot !== null &&
    Object.values(state.snapshot.players).length > 0 &&
    Object.values(state.snapshot.players).every((player) => player.ready);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Discord Activity Cooperative RPG</p>
          <h1>Discord Hero</h1>
        </div>
        <div className="connection-cluster">
          <span className={`status-dot status-${state.connectionStatus}`} aria-hidden="true" />
          <span>{connectionLabel(state.connectionStatus)}</span>
          <span className="mode-badge">{state.session?.mode ?? "-"}</span>
        </div>
      </header>

      {state.error !== null ? (
        <section className="error-banner" role="alert">
          <span>{state.error}</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "clear_error" });
            }}
          >
            閉じる
          </button>
        </section>
      ) : null}

      <Suspense fallback={<section className="battle-stage">戦闘表示を読み込んでいます。</section>}>
        <GameCanvas snapshot={state.snapshot} currentPlayerId={state.playerId} />
      </Suspense>

      <section className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>パーティー</h2>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void platformRef.current?.invite()}
            >
              招待
            </button>
          </div>
          <div className="party-list">
            {state.snapshot === null ? (
              <p className="muted">ルーム情報を待っています。</p>
            ) : (
              Object.values(state.snapshot.players).map((player) => (
                <article className="party-member" key={player.id}>
                  <div>
                    <strong>{player.displayName}</strong>
                    <span>{CLASS_LABELS[player.classId]}</span>
                  </div>
                  <div className="party-member-meta">
                    <span>
                      HP {player.hp}/{player.maxHp}
                    </span>
                    <span>{player.ready ? "準備完了" : "準備中"}</span>
                    {player.connection === "ai_controlled" ? <span>AI操作</span> : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>クラス</h2>
          <div className="class-grid">
            {HERO_CLASS_IDS.map((classId) => (
              <button
                type="button"
                key={classId}
                className={currentPlayer?.classId === classId ? "choice active" : "choice"}
                disabled={!canEditLobby}
                onClick={() => socketRef.current?.selectClass(classId)}
              >
                <strong>{CLASS_LABELS[classId]}</strong>
                <span>
                  HP {DEFAULT_CONTENT.classes[classId].maxHp} / 攻撃{" "}
                  {DEFAULT_CONTENT.classes[classId].attackPower}
                </span>
              </button>
            ))}
          </div>
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              disabled={currentPlayer === null || !canEditLobby}
              onClick={() => socketRef.current?.setReady(!(currentPlayer?.ready ?? false))}
            >
              {currentPlayer?.ready ? "準備を解除" : "準備完了"}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canEditLobby || !allReady}
              onClick={() => socketRef.current?.startMatch()}
            >
              遠征開始
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>アクティブスキル</h2>
          <div className="skill-list">
            {classDefinition === null || currentPlayer === null ? (
              <p className="muted">プレイヤー情報を待っています。</p>
            ) : (
              classDefinition.skillIds.map((skillId) => {
                const cooldown = currentPlayer.skillCooldowns[skillId] ?? 0;
                return (
                  <button
                    type="button"
                    className="skill-button"
                    key={skillId}
                    disabled={
                      state.snapshot?.status !== "running" || cooldown > 0 || currentPlayer.hp <= 0
                    }
                    onClick={() => socketRef.current?.castSkill(skillId)}
                  >
                    <strong>{skillLabel(skillId)}</strong>
                    <span>{cooldown > 0 ? `${(cooldown / 1_000).toFixed(1)}秒` : "使用可能"}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="panel">
          <h2>強化選択</h2>
          {currentPlayer === null || currentPlayer.pendingUpgradeChoices.length === 0 ? (
            <p className="muted">レベルアップすると候補が表示されます。</p>
          ) : (
            <div className="upgrade-list">
              {currentPlayer.pendingUpgradeChoices.map((upgradeId) => (
                <button
                  type="button"
                  className="choice"
                  key={upgradeId}
                  onClick={() => socketRef.current?.selectUpgrade(upgradeId)}
                >
                  <strong>{UPGRADE_LABELS[upgradeId] ?? upgradeId}</strong>
                </button>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="panel event-panel">
        <h2>イベント</h2>
        {state.recentEvents.length === 0 ? (
          <p className="muted">戦闘イベントはまだありません。</p>
        ) : (
          <ol className="event-list">
            {state.recentEvents.map((event, index) => (
              <li key={`${event.type}-${index}`}>{eventLabel(event)}</li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function connectionLabel(status: typeof INITIAL_APP_STATE.connectionStatus): string {
  switch (status) {
    case "idle":
      return "初期化中";
    case "connecting":
      return "接続中";
    case "connected":
      return "接続済み";
    case "reconnecting":
      return "再接続中";
    case "closed":
      return "切断";
  }
}

function skillLabel(skillId: string): string {
  const labels: Readonly<Record<string, string>> = {
    "guardian.fortify": "フォーティファイ",
    "guardian.shield_bash": "シールドバッシュ",
    "ranger.piercing_shot": "ピアシングショット",
    "ranger.volley": "ボレー",
    "mage.arc_burst": "アークバースト",
    "mage.chain_lightning": "チェインライトニング",
    "support.group_heal": "グループヒール",
    "support.aegis": "イージス",
  };
  return labels[skillId] ?? skillId;
}

function eventLabel(event: (typeof INITIAL_APP_STATE.recentEvents)[number]): string {
  switch (event.type) {
    case "player_joined":
      return `${event.playerId} が参加しました`;
    case "player_disconnected":
      return `${event.playerId} が切断され、AI操作へ移行しました`;
    case "player_reconnected":
      return `${event.playerId} が再接続しました`;
    case "match_started":
      return "遠征を開始しました";
    case "damage":
      return `${event.amount}ダメージ`;
    case "healing":
      return `${event.amount}回復`;
    case "enemy_defeated":
      return `${event.enemyId} を倒しました`;
    case "wave_spawned":
      return `Wave ${event.waveIndex + 1} が開始しました`;
    case "upgrade_choices_created":
      return `${event.playerId} がレベルアップしました`;
    case "upgrade_selected":
      return `${event.playerId} が ${UPGRADE_LABELS[event.upgradeId] ?? event.upgradeId} を選択しました`;
    case "match_ended":
      return event.result.outcome === "victory" ? "遠征に勝利しました" : "パーティーが全滅しました";
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; name?: unknown; code?: unknown };
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message;
    }
    if (typeof candidate.name === "string" && candidate.name.length > 0) {
      return candidate.name;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "[object]";
    }
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  return "初期化に失敗しました";
}
