import { DEFAULT_CONTENT } from "@discord-hero/content";
import { HERO_CLASS_IDS, type EquipmentSlot } from "@discord-hero/game-core";
import type {
  AccountProgress,
  DomainEventDto,
  GameSnapshot,
  GrowthPolicyDto,
  HeroClassIdDto,
  PlayerSnapshot,
  ProgressPolicyDto,
  RescuePolicyDto,
  RetreatPolicyDto,
} from "@discord-hero/protocol";
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState, type JSX } from "react";
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
  "power.training": "攻撃力 +20%",
  "vitality.training": "最大HP +30",
  "tempo.training": "スキル再使用 -15%",
  "team.restoration": "回復量 +30%",
};

const DECISION_CHOICE_LABELS: Readonly<Record<string, string>> = {
  "safe-trail": "安全な小道",
  "hazard-yard": "危険な作業場",
  "field-repair": "現地修理",
  "mystery-cache": "謎の保管庫",
  "reinforced-gate": "補強ゲート",
  "overdrive-route": "オーバードライブ経路",
};

const EQUIPMENT_LABELS: Readonly<Record<string, string>> = {
  "weapon.iron-sword": "鉄の長剣",
  "weapon.arcane-focus": "アーケインフォーカス",
  "armor.guardian-plate": "ガーディアンプレート",
  "armor.ranger-cloak": "レンジャークローク",
  "accessory.rescue-charm": "救助のお守り",
  "accessory.arcane-signet": "秘術の印章",
};

const UNLOCK_LABELS: Readonly<Record<string, string>> = {
  "achievement.workbench-victory": "ワークベンチ初勝利",
  "title.workbench-survivor": "ワークベンチの生還者",
};

const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  weapon: "武器",
  armor: "防具",
  accessory: "装飾品",
};

const GROWTH_OPTIONS: readonly { id: GrowthPolicyDto; label: string; detail: string }[] = [
  { id: "adaptive", label: "ビルド適応", detail: "現在のビルドに合う強化を均等に選びます。" },
  { id: "offense", label: "攻撃重視", detail: "攻撃力とスキル回転を優先します。" },
  { id: "survival", label: "生存重視", detail: "最大HPと回復を優先します。" },
  { id: "skill", label: "スキル重視", detail: "スキルの回転と火力を優先します。" },
  { id: "support", label: "支援重視", detail: "回復と味方を守る強化を優先します。" },
];

const PROGRESS_OPTIONS: readonly { id: ProgressPolicyDto; label: string; detail: string }[] = [
  { id: "safe", label: "安全重視", detail: "回復と確定報酬を優先します。" },
  { id: "balanced", label: "バランス", detail: "戦力と報酬の期待値を安定させます。" },
  { id: "reward", label: "報酬重視", detail: "許容範囲内で高報酬を狙います。" },
  { id: "exploration", label: "探索重視", detail: "未知のルートやイベントを探します。" },
];

const RETREAT_OPTIONS: readonly { id: RetreatPolicyDto; label: string; detail: string }[] = [
  { id: "early", label: "早め", detail: "損失リスクを検知したら帰還します。" },
  { id: "standard", label: "標準", detail: "戦力と報酬を比較して判断します。" },
  { id: "last_stand", label: "限界まで", detail: "全滅の可能性が高い時だけ帰還します。" },
];

const RESCUE_OPTIONS: readonly { id: RescuePolicyDto; label: string; detail: string }[] = [
  { id: "standard", label: "標準救助", detail: "最初に倒れた味方を自動で救助します。" },
  { id: "priority", label: "緊急救助", detail: "救助期限が近い味方を優先します。" },
  { id: "off", label: "手動のみ", detail: "自動救助を止め、必要な時だけ指示します。" },
];

interface SettingsDraft {
  classId: HeroClassIdDto;
  activeSkillIds: string[];
  weaponId: string | null;
  armorId: string | null;
  accessoryId: string | null;
  growth: GrowthPolicyDto;
  progress: ProgressPolicyDto;
  retreat: RetreatPolicyDto;
  rescue: RescuePolicyDto;
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, INITIAL_APP_STATE);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const openSettings = (): void => {
    if (currentPlayer === null) {
      return;
    }
    setSettingsDraft({
      classId: currentPlayer.classId,
      activeSkillIds:
        currentPlayer.loadout.activeSkillIds.length > 0
          ? [...currentPlayer.loadout.activeSkillIds]
          : [...DEFAULT_CONTENT.classes[currentPlayer.classId].skillIds],
      weaponId:
        currentPlayer.loadout.weaponId ?? starterEquipmentForClass(currentPlayer.classId, "weapon"),
      armorId:
        currentPlayer.loadout.armorId ?? starterEquipmentForClass(currentPlayer.classId, "armor"),
      accessoryId:
        currentPlayer.loadout.accessoryId ??
        starterEquipmentForClass(currentPlayer.classId, "accessory"),
      growth: currentPlayer.automation.growth,
      progress: currentPlayer.automation.progress,
      retreat: currentPlayer.automation.retreat,
      rescue: currentPlayer.automation.rescue,
    });
    setSettingsOpen(true);
  };

  const saveSettings = (): void => {
    if (settingsDraft === null) {
      return;
    }
    if (currentPlayer?.classId !== settingsDraft.classId) {
      socketRef.current?.selectClass(settingsDraft.classId);
    }
    socketRef.current?.setLoadout(settingsDraft.activeSkillIds);
    socketRef.current?.setEquipment(
      settingsDraft.weaponId,
      settingsDraft.armorId,
      settingsDraft.accessoryId,
    );
    socketRef.current?.setAutomationPolicy({
      growth: settingsDraft.growth,
      progress: settingsDraft.progress,
      retreat: settingsDraft.retreat,
      rescue: settingsDraft.rescue,
    });
    setSettingsOpen(false);
    setSettingsDraft(null);
  };

  const status = state.snapshot?.status ?? null;
  let view: JSX.Element;
  if (state.snapshot === null) {
    view = (
      <ConnectionView
        roomId={state.session?.roomId ?? null}
        status={state.connectionStatus}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  } else if (settingsOpen && status === "lobby" && settingsDraft !== null) {
    view = (
      <SettingsView
        draft={settingsDraft}
        onChange={setSettingsDraft}
        onCancel={() => {
          setSettingsOpen(false);
          setSettingsDraft(null);
        }}
        onSave={saveSettings}
      />
    );
  } else if (status === "lobby") {
    view = (
      <LobbyView
        snapshot={state.snapshot}
        currentPlayer={currentPlayer}
        accountProgress={state.accountProgress}
        onInvite={() => void platformRef.current?.invite()}
        onOpenSettings={openSettings}
        onReady={() => socketRef.current?.setReady(!(currentPlayer?.ready ?? false))}
        onStart={() => socketRef.current?.startMatch()}
      />
    );
  } else if (status === "running") {
    view = (
      <BattleView
        snapshot={state.snapshot}
        currentPlayer={currentPlayer}
        currentPlayerId={state.playerId}
        recentEvents={state.recentEvents}
        onCastSkill={(skillId) => socketRef.current?.castSkill(skillId)}
        onOverrideDecision={(choiceId) => {
          const decision = state.snapshot?.activeDecision;
          if (decision !== null && decision !== undefined) {
            socketRef.current?.overrideDecision(decision.decisionId, choiceId);
          }
        }}
        onRescue={(targetPlayerId) => socketRef.current?.rescuePlayer(targetPlayerId)}
      />
    );
  } else {
    view = (
      <ResultView
        snapshot={state.snapshot}
        currentPlayerId={state.playerId}
        onRetry={() => socketRef.current?.restartMatch()}
        onLobby={() => socketRef.current?.returnToLobby()}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Discord Activity / Cooperative Roguelite</p>
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

      {view}
    </main>
  );
}

interface ConnectionViewProps {
  readonly roomId: string | null;
  readonly status: typeof INITIAL_APP_STATE.connectionStatus;
  readonly onRetry: () => void;
}

function ConnectionView({ roomId, status, onRetry }: ConnectionViewProps): JSX.Element {
  return (
    <section className="connection-screen panel">
      <div className="connection-emblem" aria-hidden="true">
        ✦
      </div>
      <p className="eyebrow">ROOM LINK</p>
      <h2>遠征ルームへ接続中</h2>
      <p className="connection-copy">Discordの仲間と同じ戦場へ合流しています。</p>
      <div className="connection-detail">
        <span>状態</span>
        <strong>{connectionLabel(status)}</strong>
        <span>ルーム</span>
        <strong>{roomId ?? "準備中"}</strong>
      </div>
      {status === "closed" || status === "idle" ? (
        <button type="button" className="primary-button" onClick={onRetry}>
          再接続
        </button>
      ) : (
        <p className="muted">サーバーからの状態を待っています…</p>
      )}
    </section>
  );
}

interface LobbyViewProps {
  readonly snapshot: GameSnapshot;
  readonly currentPlayer: PlayerSnapshot | null;
  readonly accountProgress: AccountProgress | null;
  readonly onInvite: () => void;
  readonly onOpenSettings: () => void;
  readonly onReady: () => void;
  readonly onStart: () => void;
}

function LobbyView({
  snapshot,
  currentPlayer,
  accountProgress,
  onInvite,
  onOpenSettings,
  onReady,
  onStart,
}: LobbyViewProps): JSX.Element {
  const players = Object.values(snapshot.players);
  const allReady = players.length > 0 && players.every((player) => player.ready);

  return (
    <section className="screen-stack">
      <section className="expedition-banner panel">
        <div>
          <p className="eyebrow">EXPEDITION 01 / WORKBENCH OUTSKIRTS</p>
          <h2>草原のワークベンチ</h2>
          <p className="muted">NORMAL · 15〜25分 · 自動戦闘</p>
        </div>
        <div className="expedition-mark" aria-label="遠征エリア">
          01
        </div>
      </section>

      <div className="lobby-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>パーティー {players.length}/4</h2>
            <button type="button" className="secondary-button" onClick={onInvite}>
              招待
            </button>
          </div>
          <div className="party-list">
            {players.map((player) => (
              <article className="party-member lobby-member" key={player.id}>
                <div className="avatar-chip" aria-hidden="true">
                  {player.displayName.slice(0, 1)}
                </div>
                <div className="party-member-main">
                  <strong>{player.displayName}</strong>
                  <span>{CLASS_LABELS[player.classId]}</span>
                  <div className="tag-row">
                    {roleTags(player.classId).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="ready-state">
                  <span className={player.ready ? "ready-badge" : "waiting-badge"}>
                    {player.ready ? "準備済" : "準備中"}
                  </span>
                  {player.connection === "ai_controlled" ? <small>AI操作</small> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel lobby-summary">
          <div className="panel-heading">
            <h2>出発準備</h2>
            <span className="status-ribbon">AUTO RUN</span>
          </div>
          {currentPlayer === null ? (
            <p className="muted">自分のヒーロー情報を同期しています。</p>
          ) : (
            <>
              <div className="build-summary">
                <span className="build-icon" aria-hidden="true">
                  ◆
                </span>
                <div>
                  <strong>{CLASS_LABELS[currentPlayer.classId]}</strong>
                  <span>{roleTags(currentPlayer.classId).join(" · ")}</span>
                </div>
              </div>
              <AccountProgressCard accountProgress={accountProgress} />
              <div className="policy-summary">
                <div>
                  <span>成長</span>
                  <strong>{growthLabel(currentPlayer.automation.growth)}</strong>
                </div>
                <div>
                  <span>進行</span>
                  <strong>{progressLabel(currentPlayer.automation.progress)}</strong>
                </div>
                <div>
                  <span>撤退</span>
                  <strong>{retreatLabel(currentPlayer.automation.retreat)}</strong>
                </div>
              </div>
              <div className="equipment-summary">
                <span>装備</span>
                <strong>
                  {[
                    currentPlayer.loadout.weaponId,
                    currentPlayer.loadout.armorId,
                    currentPlayer.loadout.accessoryId,
                  ]
                    .filter((equipmentId): equipmentId is string => equipmentId !== null)
                    .map(equipmentLabel)
                    .join(" / ") || "未装備"}
                </strong>
                {currentPlayer.activeSynergyIds.length > 0 ? (
                  <small>
                    発動中の相性: {currentPlayer.activeSynergyIds.map(synergyLabel).join(" / ")}
                  </small>
                ) : (
                  <small>装備とスキルの組み合わせで相性が発動します。</small>
                )}
              </div>
              <button
                type="button"
                className="secondary-button full-button"
                onClick={onOpenSettings}
              >
                ヒーロー設定を編集
              </button>
            </>
          )}
          <PartyAssessment players={players} />
          <div className="button-row lobby-actions">
            <button
              type="button"
              className="primary-button"
              disabled={currentPlayer === null}
              onClick={onReady}
            >
              {currentPlayer?.ready ? "準備を解除" : "準備完了"}
            </button>
            <button type="button" className="primary-button" disabled={!allReady} onClick={onStart}>
              遠征開始
            </button>
          </div>
          {!allReady ? <p className="form-hint">全員の準備が整うと出発できます。</p> : null}
        </section>
      </div>
    </section>
  );
}

function AccountProgressCard({
  accountProgress,
}: {
  readonly accountProgress: AccountProgress | null;
}): JSX.Element {
  if (accountProgress === null) {
    return <p className="muted account-progress-loading">永続進行を同期しています。</p>;
  }

  const previousLevelExperience = Math.max(0, (accountProgress.accountLevel - 1) * 100);
  const levelSpan = Math.max(1, accountProgress.nextLevelExperience - previousLevelExperience);
  const levelProgress = Math.min(
    100,
    Math.max(0, ((accountProgress.experience - previousLevelExperience) / levelSpan) * 100),
  );
  const visibleUnlocks = accountProgress.unlockedContentIds.slice(0, 3);
  const remainingUnlockCount = Math.max(
    0,
    accountProgress.unlockedContentIds.length - visibleUnlocks.length,
  );

  return (
    <section className="account-progress-card" aria-label="永続プレイヤー進行">
      <div className="account-progress-heading">
        <div>
          <span className="eyebrow">ACCOUNT PROFILE</span>
          <strong>永続進行</strong>
        </div>
        <span className="account-level-badge">Lv.{accountProgress.accountLevel}</span>
      </div>
      <div className="account-progress-meter">
        <div className="account-progress-meter-label">
          <span>アカウント経験値</span>
          <strong>
            {accountProgress.experience} / {accountProgress.nextLevelExperience} XP
          </strong>
        </div>
        <div className="account-progress-track" aria-hidden="true">
          <i style={{ width: `${levelProgress}%` }} />
        </div>
      </div>
      <div className="account-progress-footer">
        <span>所持ゴールド</span>
        <strong>{accountProgress.gameCurrency} G</strong>
        <span>アンロック</span>
        <strong>{accountProgress.unlockedContentIds.length}件</strong>
      </div>
      {visibleUnlocks.length > 0 ? (
        <div className="account-unlock-row">
          <span>最近の解禁</span>
          <div>
            {visibleUnlocks.map((unlockId) => (
              <small key={unlockId}>{unlockLabel(unlockId)}</small>
            ))}
            {remainingUnlockCount > 0 ? <small>+{remainingUnlockCount}件</small> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface SettingsViewProps {
  readonly draft: SettingsDraft;
  readonly onChange: (draft: SettingsDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

function SettingsView({ draft, onChange, onCancel, onSave }: SettingsViewProps): JSX.Element {
  const availableSkillIds = DEFAULT_CONTENT.classes[draft.classId].skillIds;
  return (
    <section className="settings-screen panel">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">LOADOUT / AUTOMATION</p>
          <h2>ヒーロー設定</h2>
          <p className="muted">変更は次の遠征から適用されます。完成済みプリセットは使いません。</p>
        </div>
        <span className="settings-gem" aria-hidden="true">
          ✦
        </span>
      </div>

      <div className="settings-layout">
        <section className="settings-column">
          <h3>クラスコア</h3>
          <div className="class-grid settings-class-grid">
            {HERO_CLASS_IDS.map((classId) => (
              <button
                type="button"
                key={classId}
                className={draft.classId === classId ? "choice active" : "choice"}
                onClick={() => {
                  onChange({
                    ...draft,
                    classId,
                    activeSkillIds:
                      draft.classId === classId
                        ? [...draft.activeSkillIds]
                        : [...DEFAULT_CONTENT.classes[classId].skillIds],
                    weaponId:
                      draft.classId === classId
                        ? draft.weaponId
                        : starterEquipmentForClass(classId, "weapon"),
                    armorId:
                      draft.classId === classId
                        ? draft.armorId
                        : starterEquipmentForClass(classId, "armor"),
                    accessoryId:
                      draft.classId === classId
                        ? draft.accessoryId
                        : starterEquipmentForClass(classId, "accessory"),
                  });
                }}
              >
                <strong>{CLASS_LABELS[classId]}</strong>
                <span>
                  HP {DEFAULT_CONTENT.classes[classId].maxHp} · 攻撃{" "}
                  {DEFAULT_CONTENT.classes[classId].attackPower}
                </span>
                <small>{roleTags(classId).join(" · ")}</small>
              </button>
            ))}
          </div>
          <div className="recommendation-callout">
            <strong>★ おすすめの見方</strong>
            <span>おすすめは相性の案内です。選ばなくても不利にはなりません。</span>
          </div>
          <div className="skill-loadout-editor">
            <div className="settings-subheading">
              <h3>アクティブスキル</h3>
              <span>{draft.activeSkillIds.length} / 2 枠</span>
            </div>
            <div className="skill-choice-grid">
              {availableSkillIds.map((skillId) => {
                const selected = draft.activeSkillIds.includes(skillId);
                const locked = selected && draft.activeSkillIds.length === 1;
                return (
                  <button
                    type="button"
                    key={skillId}
                    className={selected ? "skill-choice selected" : "skill-choice"}
                    disabled={locked}
                    onClick={() => {
                      const nextSkillIds = selected
                        ? draft.activeSkillIds.filter((id) => id !== skillId)
                        : [...draft.activeSkillIds, skillId];
                      if (nextSkillIds.length <= 2) {
                        onChange({ ...draft, activeSkillIds: nextSkillIds });
                      }
                    }}
                  >
                    <strong>{skillLabel(skillId)}</strong>
                    <small>{selected ? "装備中" : "クリックで装備"}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="equipment-loadout-editor">
            <div className="settings-subheading">
              <h3>装備</h3>
              <span>効果と相性</span>
            </div>
            {(["weapon", "armor", "accessory"] as const).map((slot) => (
              <EquipmentSlotGroup
                key={slot}
                slot={slot}
                selectedId={
                  slot === "weapon"
                    ? draft.weaponId
                    : slot === "armor"
                      ? draft.armorId
                      : draft.accessoryId
                }
                optionIds={DEFAULT_CONTENT.classes[draft.classId].equipmentIds.filter(
                  (equipmentId) => DEFAULT_CONTENT.equipment[equipmentId]?.slot === slot,
                )}
                onChange={(equipmentId) => {
                  if (slot === "weapon") {
                    onChange({ ...draft, weaponId: equipmentId });
                  } else if (slot === "armor") {
                    onChange({ ...draft, armorId: equipmentId });
                  } else {
                    onChange({ ...draft, accessoryId: equipmentId });
                  }
                }}
              />
            ))}
          </div>
        </section>

        <section className="settings-column policy-column">
          <PolicyGroup
            title="自動成長"
            value={draft.growth}
            options={GROWTH_OPTIONS}
            onChange={(growth) => {
              onChange({ ...draft, growth });
            }}
          />
          <PolicyGroup
            title="自動進行"
            value={draft.progress}
            options={PROGRESS_OPTIONS}
            onChange={(progress) => {
              onChange({ ...draft, progress });
            }}
          />
          <PolicyGroup
            title="撤退基準"
            value={draft.retreat}
            options={RETREAT_OPTIONS}
            onChange={(retreat) => {
              onChange({ ...draft, retreat });
            }}
          />
          <PolicyGroup
            title="救助作戦"
            value={draft.rescue}
            options={RESCUE_OPTIONS}
            onChange={(rescue) => {
              onChange({ ...draft, rescue });
            }}
          />
        </section>
      </div>

      <div className="settings-footer">
        <button type="button" className="secondary-button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="primary-button" onClick={onSave}>
          変更を保存して戻る
        </button>
      </div>
    </section>
  );
}

interface EquipmentSlotGroupProps {
  readonly slot: EquipmentSlot;
  readonly selectedId: string | null;
  readonly optionIds: readonly string[];
  readonly onChange: (equipmentId: string) => void;
}

function EquipmentSlotGroup({
  slot,
  selectedId,
  optionIds,
  onChange,
}: EquipmentSlotGroupProps): JSX.Element {
  return (
    <div className="equipment-slot-group">
      <div className="equipment-slot-heading">
        <strong>{EQUIPMENT_SLOT_LABELS[slot]}</strong>
        <span>{selectedId === null ? "未装備" : equipmentEffectLabel(selectedId)}</span>
      </div>
      <div className="equipment-option-grid">
        {optionIds.length === 0 ? (
          <small className="muted">このクラスに装備できるアイテムはありません。</small>
        ) : (
          optionIds.map((equipmentId) => (
            <button
              type="button"
              key={equipmentId}
              className={
                equipmentId === selectedId ? "equipment-option selected" : "equipment-option"
              }
              onClick={() => {
                onChange(equipmentId);
              }}
            >
              <strong>{equipmentLabel(equipmentId)}</strong>
              <small>{equipmentEffectLabel(equipmentId)}</small>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

interface PolicyGroupProps<T extends string> {
  readonly title: string;
  readonly value: T;
  readonly options: readonly { id: T; label: string; detail: string }[];
  readonly onChange: (value: T) => void;
}

function PolicyGroup<T extends string>({
  title,
  value,
  options,
  onChange,
}: PolicyGroupProps<T>): JSX.Element {
  return (
    <div className="policy-group">
      <h3>{title}</h3>
      <div className="policy-options">
        {options.map((option) => (
          <button
            type="button"
            className={option.id === value ? "policy-option selected" : "policy-option"}
            key={option.id}
            onClick={() => {
              onChange(option.id);
            }}
          >
            <span className="policy-radio" aria-hidden="true">
              {option.id === value ? "●" : "○"}
            </span>
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface BattleViewProps {
  readonly snapshot: GameSnapshot;
  readonly currentPlayer: PlayerSnapshot | null;
  readonly currentPlayerId: string | null;
  readonly recentEvents: readonly DomainEventDto[];
  readonly onCastSkill: (skillId: string) => void;
  readonly onOverrideDecision: (choiceId: string) => void;
  readonly onRescue: (targetPlayerId: string) => void;
}

function BattleView({
  snapshot,
  currentPlayer,
  currentPlayerId,
  recentEvents,
  onCastSkill,
  onOverrideDecision,
  onRescue,
}: BattleViewProps): JSX.Element {
  const skillIds =
    currentPlayer === null
      ? []
      : currentPlayer.loadout.activeSkillIds.length > 0
        ? currentPlayer.loadout.activeSkillIds
        : DEFAULT_CONTENT.classes[currentPlayer.classId].skillIds;
  const boss = Object.values(snapshot.enemies).find((enemy) => enemy.boss);

  return (
    <section className="battle-screen screen-stack">
      <div className="battle-statusbar panel">
        <div>
          <span className="eyebrow">WORKBENCH OUTSKIRTS</span>
          <strong>
            Wave {Math.max(snapshot.waveIndex, 1)} / {DEFAULT_CONTENT.stage.waves.length}
          </strong>
        </div>
        <div className="battle-stat">
          <span>遠征Lv.</span>
          <strong>{currentPlayer?.level ?? 1}</strong>
        </div>
        <div className="battle-stat">
          <span>TIME</span>
          <strong>{formatDuration(snapshot.elapsedMs)}</strong>
        </div>
        <div className="boss-progress">
          <span>Boss</span>
          <div className="mini-progress">
            <i
              style={{
                width: `${boss === undefined ? 0 : Math.round((boss.hp / boss.maxHp) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {snapshot.activeDecision === null ? null : (
        <DecisionPrompt
          decision={snapshot.activeDecision}
          elapsedMs={snapshot.elapsedMs}
          currentPlayerId={currentPlayerId}
          progressPolicy={currentPlayer?.automation.progress ?? "balanced"}
          onSelect={onOverrideDecision}
        />
      )}

      <Suspense
        fallback={<section className="battle-stage panel">戦闘表示を読み込んでいます。</section>}
      >
        <GameCanvas snapshot={snapshot} currentPlayerId={currentPlayerId} />
      </Suspense>

      <section className="battle-intervention panel">
        <div className="battle-player-strip">
          <div className="battle-hero-icon" aria-hidden="true">
            {currentPlayer === null ? "?" : CLASS_LABELS[currentPlayer.classId].slice(0, 1)}
          </div>
          <div className="battle-hero-info">
            <strong>{currentPlayer?.displayName ?? "Hero"}</strong>
            <span>
              {currentPlayer === null
                ? "同期中"
                : currentPlayer.eliminated
                  ? `${CLASS_LABELS[currentPlayer.classId]} · 脱落`
                  : currentPlayer.downed
                    ? `${CLASS_LABELS[currentPlayer.classId]} · 救助待ち`
                    : currentPlayer.rescueTargetId !== null
                      ? `${CLASS_LABELS[currentPlayer.classId]} · 救助中`
                      : `${CLASS_LABELS[currentPlayer.classId]} · 自動作戦中`}
            </span>
          </div>
          <div className="hp-readout">
            <span>HP</span>
            <strong>
              {currentPlayer?.eliminated
                ? "脱落"
                : currentPlayer?.downed
                  ? "ダウン"
                  : `${currentPlayer?.hp ?? 0}/${currentPlayer?.maxHp ?? 0}`}
            </strong>
            <div className="hp-progress">
              <i style={{ width: `${healthPercent(currentPlayer)}%` }} />
            </div>
          </div>
        </div>
        <div className="auto-notice">
          <span aria-hidden="true">✦</span>
          <span>通常攻撃・スキル・遠征強化はサーバーが自動進行しています。</span>
          <strong>
            {currentPlayer === null ? "" : growthLabel(currentPlayer.automation.growth)}
          </strong>
        </div>
        {currentPlayer !== null && currentPlayer.activeSynergyIds.length > 0 ? (
          <div className="synergy-notice">
            <span aria-hidden="true">✦</span>
            <span>発動中の相性</span>
            <strong>{currentPlayer.activeSynergyIds.map(synergyLabel).join(" / ")}</strong>
          </div>
        ) : null}
        <div className="skill-toolbar">
          {skillIds.map((skillId) => {
            const cooldown = currentPlayer?.skillCooldowns[skillId] ?? 0;
            const disabled =
              currentPlayer === null ||
              currentPlayer.downed ||
              currentPlayer.eliminated ||
              currentPlayer.rescueTargetId !== null ||
              cooldown > 0;
            return (
              <button
                type="button"
                className="skill-button compact-skill"
                key={skillId}
                disabled={disabled}
                onClick={() => {
                  onCastSkill(skillId);
                }}
              >
                <strong>{skillLabel(skillId)}</strong>
                <span>{cooldown > 0 ? `${(cooldown / 1_000).toFixed(1)}s` : "自動 / 介入"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="battle-lower-grid">
        <section className="panel compact-party-panel">
          <div className="panel-heading">
            <h2>味方の状態</h2>
            <span className="muted">{Object.keys(snapshot.players).length}人</span>
          </div>
          <div className="compact-party-list">
            {Object.values(snapshot.players).map((player) => (
              <div className="compact-party-row" key={player.id}>
                <span className="compact-avatar">{player.displayName.slice(0, 1)}</span>
                <span>
                  <strong>{player.displayName}</strong>
                  <small>{CLASS_LABELS[player.classId]}</small>
                </span>
                <strong className={player.downed || player.eliminated ? "danger-text" : ""}>
                  {player.eliminated
                    ? "脱落"
                    : player.downed
                      ? "ダウン"
                      : `${player.hp}/${player.maxHp}`}
                </strong>
                {player.downed &&
                currentPlayer !== null &&
                currentPlayer.id !== player.id &&
                !currentPlayer.downed &&
                !currentPlayer.eliminated ? (
                  <button
                    type="button"
                    className="rescue-button"
                    disabled={
                      currentPlayer.rescueTargetId !== null || currentPlayer.rescueCooldownMs > 0
                    }
                    onClick={() => {
                      onRescue(player.id);
                    }}
                  >
                    {currentPlayer.rescueTargetId === player.id ? "救助中" : "救助"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section className="panel compact-log-panel">
          <div className="panel-heading">
            <h2>遠征ログ</h2>
            <span className="muted">自動処理</span>
          </div>
          {recentEvents.length === 0 ? (
            <p className="muted">戦闘ログを待っています。</p>
          ) : (
            <ol className="event-list compact-event-list">
              {recentEvents.slice(0, 6).map((event, index) => (
                <li key={`${event.type}-${index}`}>{eventLabel(event)}</li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </section>
  );
}

interface DecisionPromptProps {
  readonly decision: NonNullable<GameSnapshot["activeDecision"]>;
  readonly elapsedMs: number;
  readonly currentPlayerId: string | null;
  readonly progressPolicy: ProgressPolicyDto;
  readonly onSelect: (choiceId: string) => void;
}

function DecisionPrompt({
  decision,
  elapsedMs,
  currentPlayerId,
  progressPolicy,
  onSelect,
}: DecisionPromptProps): JSX.Element {
  const remainingMs = Math.max(0, decision.deadlineMs - elapsedMs);
  const selectedChoiceId =
    currentPlayerId === null ? null : (decision.votes[currentPlayerId] ?? null);
  return (
    <section className="decision-prompt panel">
      <div className="decision-prompt-heading">
        <div>
          <span className="eyebrow">
            AUTO DECISION / {decision.kind === "route" ? "ROUTE" : "EVENT"}
          </span>
          <h2>{decision.kind === "route" ? "進行ルートを確認" : "イベントの対応を確認"}</h2>
        </div>
        <div className="decision-countdown">
          <strong>{(remainingMs / 1_000).toFixed(1)}s</strong>
          <small>自動確定</small>
        </div>
      </div>
      <p className="decision-prompt-copy">
        {progressLabel(progressPolicy)}の自動票を使用中。選択すると自分の票だけを上書きできます。
      </p>
      <div className="decision-choice-grid">
        {decision.choices.map((choice) => {
          const selected = selectedChoiceId === choice.id;
          return (
            <button
              type="button"
              className={selected ? "decision-choice selected" : "decision-choice"}
              key={choice.id}
              onClick={() => {
                onSelect(choice.id);
              }}
            >
              <span>
                <strong>{DECISION_CHOICE_LABELS[choice.id] ?? choice.id}</strong>
                <small>
                  {choice.kind === "risky" || choice.kind === "mystery" ? "危険あり" : "安定寄り"}
                </small>
              </span>
              <span className="decision-choice-meta">
                <small>危険度 {choice.risk}</small>
                <small>報酬 {choice.reward}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="decision-prompt-footer">
        <span>自動票 {Object.keys(decision.votes).length}人</span>
        <span>上書き済み {decision.overriddenPlayerIds.length}人</span>
      </div>
    </section>
  );
}

interface ResultViewProps {
  readonly snapshot: GameSnapshot;
  readonly currentPlayerId: string | null;
  readonly onRetry: () => void;
  readonly onLobby: () => void;
}

function ResultView({ snapshot, currentPlayerId, onRetry, onLobby }: ResultViewProps): JSX.Element {
  const victory = snapshot.status === "victory";
  const returned = snapshot.status === "return";
  const reward =
    currentPlayerId === null || snapshot.result === null
      ? null
      : (snapshot.result.rewards[currentPlayerId] ?? null);
  const unlockedIds =
    currentPlayerId === null || snapshot.result === null
      ? []
      : (snapshot.result.unlocks[currentPlayerId] ?? []);
  return (
    <section className="result-screen panel">
      <div
        className={
          victory
            ? "result-seal victory-seal"
            : returned
              ? "result-seal return-seal"
              : "result-seal defeat-seal"
        }
        aria-hidden="true"
      >
        {victory ? "★" : returned ? "↩" : "×"}
      </div>
      <p className="eyebrow">EXPEDITION REPORT</p>
      <h2>{victory ? "遠征成功" : returned ? "安全に帰還" : "遠征失敗"}</h2>
      <p className="result-lead">
        {victory
          ? "ワークベンチの奥地を制圧しました。"
          : returned
            ? "撤退基準に従い、獲得した報酬を持ち帰りました。"
            : "パーティーは戦場で力尽きました。"}
      </p>
      <div className="result-summary">
        <div>
          <span>到達Wave</span>
          <strong>
            {snapshot.waveIndex} / {DEFAULT_CONTENT.stage.waves.length}
          </strong>
        </div>
        <div>
          <span>経過時間</span>
          <strong>{formatDuration(snapshot.result?.durationMs ?? snapshot.elapsedMs)}</strong>
        </div>
        <div>
          <span>参加人数</span>
          <strong>{Object.keys(snapshot.players).length}人</strong>
        </div>
      </div>
      <section className="result-reward-panel">
        <div>
          <span>あなたの報酬</span>
          <strong>{reward === null ? "精算待ち" : `${reward.currency} G`}</strong>
        </div>
        <div>
          <span>アカウント経験値</span>
          <strong>{reward === null ? "—" : `+${reward.experience} XP`}</strong>
        </div>
      </section>
      {unlockedIds.length > 0 ? (
        <section className="result-unlock-panel">
          <div className="unlock-heading">
            <span>NEW UNLOCK</span>
            <strong>新規アンロック</strong>
          </div>
          <div className="unlock-list">
            {unlockedIds.map((unlockId) => (
              <span className="unlock-chip" key={unlockId}>
                ✦ {unlockLabel(unlockId)}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <section className="result-party">
        <h3>パーティー戦績</h3>
        {Object.values(snapshot.players).map((player) => (
          <div className="result-player" key={player.id}>
            <span>
              <strong>{player.displayName}</strong>
              <small>{CLASS_LABELS[player.classId]}</small>
            </span>
            <span>
              <small>撃破 {player.stats.enemiesDefeated}</small>
              <small>回復 {player.stats.healingDone}</small>
              <strong>{player.score} pts</strong>
            </span>
          </div>
        ))}
      </section>
      <div className="result-actions">
        <button type="button" className="secondary-button" onClick={onLobby}>
          ロビーへ戻る
        </button>
        <button type="button" className="primary-button" onClick={onRetry}>
          もう一度挑戦
        </button>
      </div>
    </section>
  );
}

function unlockLabel(unlockId: string): string {
  return UNLOCK_LABELS[unlockId] ?? unlockId;
}

function PartyAssessment({
  players,
}: {
  readonly players: readonly PlayerSnapshot[];
}): JSX.Element {
  const classes = new Set(players.map((player) => player.classId));
  const assessments = [
    ["前衛", classes.has("guardian") ? "十分" : "少ない", classes.has("guardian") ? "good" : "low"],
    [
      "単体火力",
      classes.has("ranger") || classes.has("mage") ? "十分" : "少ない",
      classes.has("ranger") || classes.has("mage") ? "good" : "low",
    ],
    [
      "範囲火力",
      classes.has("mage") || players.length >= 3 ? "普通" : "少ない",
      classes.has("mage") || players.length >= 3 ? "normal" : "low",
    ],
    ["回復", classes.has("support") ? "十分" : "なし", classes.has("support") ? "good" : "low"],
  ] as const;
  return (
    <div className="assessment">
      <div className="panel-heading">
        <h3>構成評価</h3>
        <span className="muted">案内のみ</span>
      </div>
      <div className="assessment-grid">
        {assessments.map(([label, value, tone]) => (
          <div key={label}>
            <span>{label}</span>
            <strong className={`assessment-${tone}`}>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function roleTags(classId: HeroClassIdDto): readonly string[] {
  switch (classId) {
    case "guardian":
      return ["前衛", "防御", "妨害"];
    case "ranger":
      return ["単体火力", "弱点"];
    case "mage":
      return ["範囲火力", "妨害"];
    case "support":
      return ["回復", "強化"];
  }
}

function starterEquipmentForClass(classId: HeroClassIdDto, slot: EquipmentSlot): string | null {
  return (
    DEFAULT_CONTENT.classes[classId].equipmentIds.find(
      (equipmentId) => DEFAULT_CONTENT.equipment[equipmentId]?.slot === slot,
    ) ?? null
  );
}

function equipmentLabel(equipmentId: string): string {
  return EQUIPMENT_LABELS[equipmentId] ?? equipmentId;
}

function equipmentEffectLabel(equipmentId: string): string {
  const equipment = DEFAULT_CONTENT.equipment[equipmentId];
  if (equipment === undefined || equipment.effects.length === 0) {
    return "効果なし";
  }
  return equipment.effects
    .map((effect) => {
      switch (effect.type) {
        case "attack_power_bonus":
          return `攻撃 +${effect.amount}`;
        case "max_hp_bonus":
          return `最大HP +${effect.amount}`;
        case "attack_interval_multiplier":
          return `攻撃間隔 ${(effect.multiplier * 100).toFixed(0)}%`;
        case "skill_cooldown_multiplier":
          return `スキル待機 ${(effect.multiplier * 100).toFixed(0)}%`;
        case "healing_multiplier":
          return `回復 ${(effect.multiplier * 100).toFixed(0)}%`;
        case "rescue_duration_multiplier":
          return `救助時間 ${(effect.multiplier * 100).toFixed(0)}%`;
        case "shield_on_wave":
          return `Wave開始時シールド +${effect.amount}`;
      }
    })
    .join(" / ");
}

function synergyLabel(synergyId: string): string {
  const labels: Readonly<Record<string, string>> = {
    "barrier-vanguard": "バリア・ヴァンガード",
    "arcane-resonance": "アーケイン・レゾナンス",
  };
  return labels[synergyId] ?? synergyId;
}

function growthLabel(value: GrowthPolicyDto): string {
  return GROWTH_OPTIONS.find((option) => option.id === value)?.label ?? value;
}
function progressLabel(value: ProgressPolicyDto): string {
  return PROGRESS_OPTIONS.find((option) => option.id === value)?.label ?? value;
}
function retreatLabel(value: RetreatPolicyDto): string {
  return RETREAT_OPTIONS.find((option) => option.id === value)?.label ?? value;
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

function eventLabel(event: DomainEventDto): string {
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
    case "decision_opened":
      return `${event.decision.kind === "route" ? "ルート" : "イベント"}の自動判断を開始`;
    case "decision_overridden":
      return `${event.playerId} が「${DECISION_CHOICE_LABELS[event.choiceId] ?? event.choiceId}」へ票を上書き`;
    case "decision_resolved":
      return `${event.decision.kind === "route" ? "ルート" : "イベント"}「${DECISION_CHOICE_LABELS[event.decision.choiceId] ?? event.decision.choiceId}」を自動選択`;
    case "retreat_decided":
      return `撤退基準により帰還（平均HP ${event.averageHpPercent}%）`;
    case "player_downed":
      return `${event.playerId} がダウン。救助受付中`;
    case "rescue_started":
      return `${event.rescuerId} が ${event.targetId} の救助を開始`;
    case "player_rescued":
      return `${event.targetId} を救助（HP ${event.hp}）`;
    case "player_eliminated":
      return `${event.playerId} の救助期限切れ。脱落`;
    case "equipment_changed":
      return `${event.playerId} の装備を更新${event.synergyIds.length > 0 ? `（相性 ${event.synergyIds.length}件）` : ""}`;
    case "upgrade_choices_created":
      return `${event.playerId} がレベルアップしました`;
    case "upgrade_selected":
      return `${event.playerId} に${UPGRADE_LABELS[event.upgradeId] ?? event.upgradeId}を自動適用`;
    case "skill_used":
      return `${event.playerId} が${skillLabel(event.skillId)}を使用`;
    case "match_ended":
      if (event.result.outcome === "victory") return "遠征に勝利しました";
      if (event.result.outcome === "return") return "安全に帰還しました";
      return "パーティーが全滅しました";
  }
}

function healthPercent(player: PlayerSnapshot | null): number {
  if (player === null || player.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; name?: unknown };
    if (typeof candidate.message === "string" && candidate.message.length > 0)
      return candidate.message;
    if (typeof candidate.name === "string" && candidate.name.length > 0) return candidate.name;
  }
  return "初期化に失敗しました";
}
