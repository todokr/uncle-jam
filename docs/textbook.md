# Software Factory を理解するための教科書

このリポジトリ (`uncle-jam`) は、「Software Factory」という言葉の一番新しい使われ方
— AIエージェントが設計・実装・テストを回す工場ライン — を理解するために、
その土台となる仕組みだけをミニマムに実装したものです。この文書はそのコードを
教材として読み解くための解説です。

## 1. 「Software Factory」は一つの言葉に三つの世代がある

同じ言葉でも指しているものが時代でまったく違います。混乱しないために先に整理します。

| 世代 | 意味 | 主体 |
|---|---|---|
| 1980〜2000年代 | パターン・フレームワーク・DSLで組み立てる、モデル駆動開発の工場化（Greenfield & Short『Software Factories』） | 人間 |
| 2010年代後半〜 | Platform Engineering。Backstageのようなポータルでゴールデンパス（CI/CDテンプレート、セルフサービス基盤）を提供する工場化 | 人間（プラットフォームが定型作業を肩代わり） |
| 2023年〜 | AIエージェントが設計→実装→テストの各工程を自律的にこなす工場ライン | AIエージェント |

このリポジトリが再現するのは3番目です。ただし3番目を成立させている技術的な核心は、
実は「AI」そのものではなく、**長時間・複数ステップにわたる処理を、失敗しても
途中から再開できる形で走らせる仕組み**（durable workflow execution）です。
これはAIエージェント特有の話ではなく、決済処理や注文処理のような
昔からあるワークフローエンジンの技術です。AIエージェントの工場ラインは、
このワークフローエンジンの「各ステップ」を人間の代わりにLLMが実行するだけ、
と捉えると理解しやすくなります。

## 2. なぜ「状態機械 + スナップショット」が核心なのか

設計→実装→テストのループを想像してください。

1. 設計エージェントが仕様を書く
2. 実装エージェントがコードを書く
3. テストエージェントが実行し、失敗したら2に戻る
4. 人間のレビュー承認を待つ（何分〜何時間もかかる）
5. デプロイする

これを1本のスクリプトで `await` を並べて書くと、途中でプロセスが落ちたら
全部やり直しになります。人間の承認待ちのように「外部からの合図が来るまで
止まる」ことも、ただの`await`では表現できません（プロセスを止めたまま
何時間も持たせるわけにはいかない）。

これを解決する最小構成が2つです。

- **状態機械（State Machine）**: 「今どの段階にいるか」を`pending` /
  `running` / `suspended` / `completed` / `failed` のような明示的な状態として
  持つ。「suspendして、resumeが来たらrunningに戻る」という遷移を許可された
  組み合わせだけに制限する。
- **スナップショット（Snapshot）**: その状態を含む実行コンテキスト全体を、
  ステップが進むたびにディスク（やDB）に書き出す。プロセスが落ちても、
  スナップショットを読み込めば「最後に完了したステップの次」から再開できる。

Mastra（TypeScript製のAIエージェント/ワークフローフレームワーク）は、
ワークフローの制御フローをXStateという状態機械ライブラリに任せ、
各ステップの実行結果をスナップショットとして永続化することで、
suspend/resumeとクラッシュ耐性を実現しています。このリポジトリは
XStateも使わず、その2つのアイデアを直接コードにしたものです。

## 3. コードウォークスルー

### `src/fsm.ts` — 状態機械そのもの

```ts
export type State = "pending" | "running" | "suspended" | "completed" | "failed";
export type Event = "start" | "step" | "suspend" | "complete" | "fail" | "resume";

const TRANSITIONS: Partial<Record<State, Partial<Record<Event, State>>>> = {
  pending: { start: "running" },
  running: { suspend: "suspended", complete: "completed", fail: "failed", step: "running" },
  suspended: { resume: "running" },
  completed: {},
  failed: {},
};
```

遷移表がすべてです。`completed`や`failed`からはどのイベントを送っても
遷移先がない（＝終端状態）ので、`send()`は例外を投げます。これが
「終わったワークフローは書き換えられない」という保証をコード1行で
表現しています。

### `src/snapshot.ts` — 実行状態の永続化

```ts
export interface Snapshot<TContext> {
  state: State;
  stepIndex: number;
  context: TContext;
  history: HistoryEntry[];
  waitingOn?: string;
  error?: string;
}
```

「今どのステップの何番目か（`stepIndex`）」「そこまでに積み上がった
データ（`context`）」「これまでの実行履歴（`history`）」を1つのJSONに
まとめているだけです。`save`/`load`はただの`writeFile`/`readFile`。
本番のMastraやTemporal/Inngestではこれがデータベースやオブジェクト
ストレージになりますが、原理は同じです。

### `src/engine.ts` — 状態機械を1ステップずつ前に進めるループ

これが「ワーカー」に相当する部分です。やっていることは3行で説明できます。

1. スナップショットを読む（なければ新規作成）
2. 現在の`stepIndex`のステップを実行する
3. 結果に応じて状態機械を遷移させ、スナップショットを書き戻す

```ts
while (fsm.state === "running" && snapshot.stepIndex < workflow.length) {
  const step = workflow[snapshot.stepIndex]!;
  const result = await step.execute(snapshot.context, pendingResumeData);

  if (result.status === "suspend") { /* state -> suspended, 保存して return */ }
  if (result.status === "fail")    { /* state -> failed,    保存して return */ }

  // continue: contextを更新してstepIndexを進め、保存してループ続行
}
```

重要なのは **ステップが1つ進むたびに保存している** ことです。3ステップの
ワークフローの2ステップ目でプロセスが強制終了しても、次に`run()`を
呼んだときはスナップショットの`stepIndex: 1`から再開されます。1ステップ目を
やり直すことはありません。

### `examples/order-workflow.ts` — suspendが必要になる具体例

`validate → waitForApproval → ship` という3ステップ。真ん中の
`waitForApproval`だけ特別で、`resumeData`（外部からの承認結果）が
まだ渡されていなければ`suspend`を返します。

```ts
async execute(context, resumeData) {
  if (resumeData === undefined) {
    return { status: "suspend" };       // 誰かが承認するまで止まる
  }
  if (!resumeData.approved) {
    return { status: "fail", error: new Error("order was rejected") };
  }
  return { status: "continue", context: { ...context, approved: true } };
}
```

これがAIエージェント版工場ラインで言う「人間のレビュー承認待ち」や
「別のAIエージェントの完了を待つ」に相当する箇所です。1つのプロセスの
中で`await`し続けるのではなく、いったんプロセスを終了してよい
（＝suspend状態でスナップショットを保存して`return`する）のがポイントです。

### `src/jobStore.ts` + カンバンUI — 複数ジョブを同時に見る

ここまでは「1つのワークフローの実行」を1つの`snapshot.json`で表していました。
実際の工場ラインには複数のジョブが同時に流れているので、それを見るには
「1ジョブ = 1スナップショットファイル」に分割するだけで足ります。
状態機械やエンジンのコードは一切変えていません。`run()`に渡す
`snapshotPath`を`snapshots/<jobId>.json`にしただけです。

```ts
export function jobPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.json`);
}
```

カンバンUIの5つの列（pending/running/suspended/completed/failed）は
そのまま`fsm.ts`の5つの状態に対応しています。`GET /api/jobs`は
`snapshots/`配下の全ファイルを読んで、その`state`でグルーピングして
返しているだけです。

もう1つ重要な変更が`src/server.ts`にあります。ジョブを作る
`POST /api/jobs`は`run()`の完了を待たずに202を返し、`run()`は
バックグラウンドで進みます（fire-and-forget）。これによって
「1回のHTTPリクエスト」と「1回のワークフロー実行」が分離されました。
これはAIエージェントの工場ラインでもまったく同じ形になります —
「タスクを積む」というリクエストと、「エージェントがそのタスクを
実際にこなす」処理は別物で、後者は数分〜数時間かかることもあるからです。
カンバンボードは0.7秒ごとに`GET /api/jobs`をポーリングしているだけの
単純な実装ですが、これで「バックグラウンドで動いているジョブの今」を
見ることができます。`cli.ts`は`snapshots/default.json`という1つの
決め打ちジョブを見ているだけで、UIとCLIは「同じ`run()`エンジンに対する
2つの入り口」でしかありません。

## 4. 実際に動かしてみる

```sh
npm install
npm run serve         # http://localhost:3000 でUIが立つ
```

ブラウザで開いて、order idを入れて`run new job`を押すと`pending`列に
ジョブが現れ、すぐ`running`列へ移り（`validate`ステップに1.5秒のsleepが
入れてある）、その後`waiting for approval`列で止まります（ブラウザを
リロードしても、サーバーを再起動しても状態は消えません — `snapshots/`配下の
JSONファイルに書かれているからです）。`approve`を押すと再び`running`を
経て`completed`まで進み、`reject`なら`failed`になります。複数のorder idで
同時に`run new job`すれば、ボード上で複数ジョブが並行に流れているのも
見えます。

CLIから同じことをする場合:

```sh
npm run run -- --order-id ORDER-42
npm run resume -- --approve   # 別プロセス起動でも続きから再開できる
npm run reset
```

「別プロセス起動でも続きから再開できる」がこの教科書の一番伝えたいことです。
これがなければ「AIエージェントが工場ラインとして動く」ことはできません
（エージェントの1回の実行は有限時間で終わる関数呼び出しであり、
承認待ちのような不定時間の中断を`await`し続けることはできないからです）。

## 5. Mastra本体、そしてその先へ

このリポジトリと実際のMastra/Temporal/Inngestとの対応:

| このリポジトリ | 本番のワークフローエンジン |
|---|---|
| `src/fsm.ts`の遷移表 | XState（Mastra） |
| `snapshot.json` 1ファイル | DB/オブジェクトストレージ（Postgres, S3など） |
| `while`ループを1プロセスで実行 | Inngest/Temporalのワーカーがキューから引いて実行、複数ワーカーに分散、リトライやスケジューリング付き |
| `execute()`の中身が固定ロジック | `execute()`の中身がLLM呼び出し（設計/実装/テストのプロンプト） |

「AIエージェントが設計→実装→テストまでやる工場ライン」を本気で作るなら、
`order-workflow.ts`の3ステップを次のように置き換えるだけで骨格は変わりません。

- `design`: LLMに仕様からタスク分解・設計案を書かせる（`suspend`せず`continue`）
- `implement`: LLMにコードを書かせ、リポジトリにコミットする
- `test`: CIを実行し、失敗したら`implement`に戻るか`fail`にする
- `reviewApproval`: 人間のレビューが来るまで`suspend`する（このリポジトリの
  `waitForApproval`とまったく同じ形）
- `deploy`: マージ・デプロイする

つまり「AIエージェントの工場ライン」を理解する近道は、AIの部分を
勉強することではなく、まずこの状態機械+スナップショットの仕組みを
手を動かして理解することです。AIはあくまで`execute()`の中身の1実装に
すぎません。

## 6. まとめ

- 「Software Factory」は時代によって意味が違う言葉。AIエージェント版は
  最新だが、それを支える技術（durable workflow execution）自体は新しくない。
- 核心は「状態機械」（今どの段階か、を明示的に持ち遷移を制限する）と
  「スナップショット」（その状態を毎ステップ永続化し、途中から再開できる
  ようにする）の組み合わせ。
- このリポジトリはその2つだけを外部依存なしで実装したもの。CLIとUIは
  同じエンジンへの2つの入り口にすぎない。
- 本番のワークフローエンジン（Mastra, Temporal, Inngest）は、この仕組みを
  複数プロセス・複数マシンにスケールさせ、リトライやスケジューリングを
  足したもの。原理はここにある。

## 参考文献

- Jack Greenfield, Keith Short, *Software Factories: Assembling Applications
  with Patterns, Models, Frameworks, and Tools* (2004)
- [Backstage](https://backstage.io/) — Platform Engineeringのリファレンス実装
- [CNCF Platforms White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [Mastra Docs — Workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra Docs — Snapshots](https://mastra.ai/docs/workflows/snapshots)
- [Temporal](https://temporal.io/) / [Inngest](https://www.inngest.com/) —
  本番グレードのdurable execution基盤
