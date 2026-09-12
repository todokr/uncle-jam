# uncle-jam

Mastraのworkflowエンジンの核（状態機械 + ステップ単位のスナップショット）だけを
外部依存なしで抜き出したミニ実装。「Software Factory」を、設計→実装→テストを
自律的にこなす工場ラインとして理解するための土台。

## 構成

- `src/fsm.js` — 状態機械そのもの。`pending -> running -> (suspended|completed|failed)`
  という遷移表を持つだけの数十行。Mastra本体はここをXStateに任せている。
- `src/snapshot.js` — 実行状態(state, 現在のstep位置, context, 履歴)をJSONとして
  ディスクに読み書きするだけの関数。
- `src/engine.js` — 状態機械を1ステップずつ前進させ、進むたびにスナップショットを
  書き込むループ。1ステップごとに永続化するので、プロセスが落ちても失うのは
  最大1ステップ分だけ。Mastraだとこのループの実行主体をInngest/Temporalに
  委譲することで本当の耐久実行にできるが、ここでは仕組みを見せるために1プロセス。
- `examples/order-workflow.js` — `validate -> waitForApproval -> ship` という
  3ステップのワークフロー例。`waitForApproval` は外部からの承認が来るまで
  `suspend` して止まる、単純な直列スクリプトでは書けない挙動のデモ。

## 使い方

```sh
node cli.js run --order-id ORDER-42   # validateまで進んでsuspend
cat snapshot.json                     # 止まった時点の状態が見える
node cli.js resume --approve          # 別プロセスから再開してcompletedまで進む
node cli.js resume --reject           # 却下してfailedにする場合
node cli.js reset                     # スナップショットを消して最初からやり直す
```

`resume`は`run`とは別のプロセス起動でも、スナップショットさえ残っていれば
続きから再開できる。これが「状態機械 + snapshot」で得られる耐久性の最小例。
