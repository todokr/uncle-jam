# uncle-jam

Mastraのworkflowエンジンの核（状態機械 + ステップ単位のスナップショット）だけを
ランタイム依存なしで抜き出したミニ実装（TypeScript製、devDependencyは
typescript/@types/nodeのみ）。「Software Factory」を、設計→実装→テストを
自律的にこなす工場ラインとして理解するための土台。

解説は [docs/textbook.md](docs/textbook.md) にまとめてある。

## 構成

- `src/fsm.ts` — 状態機械そのもの。`pending -> running -> (suspended|completed|failed)`
  という遷移表を持つだけの数十行。Mastra本体はここをXStateに任せている。
- `src/snapshot.ts` — 実行状態(state, 現在のstep位置, context, 履歴)をJSONとして
  ディスクに読み書きするだけの関数。
- `src/engine.ts` — 状態機械を1ステップずつ前進させ、進むたびにスナップショットを
  書き込むループ。1ステップごとに永続化するので、プロセスが落ちても失うのは
  最大1ステップ分だけ。Mastraだとこのループの実行主体をInngest/Temporalに
  委譲することで本当の耐久実行にできるが、ここでは仕組みを見せるために1プロセス。
- `examples/order-workflow.ts` — `validate -> waitForApproval -> ship` という
  3ステップのワークフロー例。`waitForApproval` は外部からの承認が来るまで
  `suspend` して止まる、単純な直列スクリプトでは書けない挙動のデモ。
- `src/jobStore.ts` — 1ジョブ = 1スナップショットファイルとして、
  `snapshots/`配下に複数ジョブを並行管理するための薄いラッパー。
- `src/server.ts` + `public/index.html` — 複数ジョブの実行状況を見る
  カンバンUI。ジョブ作成/承認は裏で非同期に`run()`が進み、状態が
  変わるたびにボードへ反映される（`pending → running → suspended →
  running → completed`のような遷移がポーリングで見える）。

## 使い方

### カンバンUI

```sh
npm install
npm run serve   # http://localhost:3000
```

order idを入力して`run new job`を押すとジョブが作られ、裏で非同期に
`validate`が進む(1.5秒)。`waiting for approval`列に来たら`approve`/`reject`。
`completed`/`failed`のカードは`remove`で消せる。複数ジョブを同時に走らせて
カンバン上で並行に動くところも試せる。

### CLI（単一ジョブ）

```sh
npm install                          # typescript / @types/node を取得
npm run run -- --order-id ORDER-42   # ビルドしてvalidateまで進みsuspend
cat snapshots/default.json           # 止まった時点の状態が見える
npm run resume -- --approve          # 別プロセスから再開してcompletedまで進む
npm run resume -- --reject           # 却下してfailedにする場合
npm run reset                        # スナップショットを消して最初からやり直す
```

`resume`は`run`とは別のプロセス起動でも、スナップショットさえ残っていれば
続きから再開できる。これが「状態機械 + snapshot」で得られる耐久性の最小例。
CLIは`snapshots/default.json`という決め打ちの1ジョブを、UIは
`snapshots/*.json`の複数ジョブを見ているだけで、どちらも同じ`run()`を
呼んでいる。
