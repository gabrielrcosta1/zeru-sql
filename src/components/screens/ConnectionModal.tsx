import { useState } from "react";
import { Plug, Zap, Check, Lock, Loader2, AlertTriangle } from "lucide-react";
import type { Engine } from "@/types";
import { useApp } from "@/store/app";
import * as api from "@/lib/api";
import { ENGINE_META, EngineIcon } from "@/components/ui/engine";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

const ENGINES: Engine[] = ["postgres", "mysql", "mariadb", "sqlite", "sqlserver"];

type TestState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; ms: number }
  | { state: "error"; msg: string };

export function ConnectionModal() {
  const {
    connectionModalOpen,
    openConnectionModal,
    connectAndLoad,
    connecting,
    connectError,
    clearConnectError,
  } = useApp();

  const [engine, setEngine] = useState<Engine>("postgres");
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState<string>(String(ENGINE_META.postgres.defaultPort ?? ""));
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(true);
  const [filePath, setFilePath] = useState("");
  const [test, setTest] = useState<TestState>({ state: "idle" });

  const meta = ENGINE_META[engine];
  const isSqlite = engine === "sqlite";

  const changeEngine = (e: Engine) => {
    setEngine(e);
    setPort(String(ENGINE_META[e].defaultPort ?? ""));
    setTest({ state: "idle" });
  };

  const payload = (): api.ConnectPayload => ({
    id: "__form__",
    engine,
    host: isSqlite ? undefined : host,
    port: isSqlite ? undefined : Number(port) || undefined,
    database: isSqlite ? undefined : database || undefined,
    username: isSqlite ? undefined : username || undefined,
    password: isSqlite ? undefined : password || undefined,
    ssl: isSqlite ? undefined : ssl,
    filePath: isSqlite ? filePath || undefined : undefined,
  });

  const runTest = async () => {
    setTest({ state: "testing" });
    const t0 = performance.now();
    try {
      if (api.isTauri) {
        await api.testConnection(payload());
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
      setTest({ state: "ok", ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setTest({ state: "error", msg: String(e) });
    }
  };

  const save = async () => {
    clearConnectError();
    try {
      await connectAndLoad({
        name,
        engine,
        host: isSqlite ? undefined : host,
        port: isSqlite ? undefined : Number(port) || undefined,
        database: isSqlite ? undefined : database || undefined,
        username: isSqlite ? undefined : username || undefined,
        password: isSqlite ? undefined : password || undefined,
        ssl: isSqlite ? undefined : ssl,
        filePath: isSqlite ? filePath || undefined : undefined,
      });
      openConnectionModal(false);
    } catch {
      // connectError is surfaced in the footer.
    }
  };

  return (
    <Modal
      open={connectionModalOpen}
      onClose={() => openConnectionModal(false)}
      width="max-w-xl"
      icon={
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-iris/15 text-iris">
          <Plug size={18} />
        </div>
      }
      title="Nova conexão"
      subtitle="Configure o acesso ao seu banco de dados"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-2xs">
            {test.state === "ok" && (
              <span className="flex items-center gap-1 text-teal">
                <Check size={13} /> Conexão bem-sucedida · {test.ms} ms
              </span>
            )}
            {test.state === "error" && (
              <span className="flex items-center gap-1 text-rose">
                <AlertTriangle size={13} /> {test.msg}
              </span>
            )}
            {connectError && test.state !== "error" && (
              <span className="flex items-center gap-1 text-rose">
                <AlertTriangle size={13} /> {connectError}
              </span>
            )}
          </div>
          <Button variant="subtle" onClick={runTest} className="gap-1.5">
            {test.state === "testing" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Zap size={13} />
            )}
            Testar conexão
          </Button>
          <Button variant="primary" onClick={save} disabled={connecting} className="gap-1.5">
            {connecting && <Loader2 size={13} className="animate-spin" />}
            Salvar & conectar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Engine picker */}
        <div>
          <div className="mb-2 text-xs font-medium text-content-muted">Tipo de banco</div>
          <div className="grid grid-cols-5 gap-2">
            {ENGINES.map((e) => {
              // Offering an engine the backend refuses to open would send the
              // user through a whole form to reach a guaranteed error.
              const supported = ENGINE_META[e].supported;
              return (
                <button
                  key={e}
                  onClick={() => supported && changeEngine(e)}
                  disabled={!supported}
                  title={supported ? undefined : "Ainda não suportado"}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all",
                    !supported && "cursor-not-allowed opacity-40",
                    engine === e
                      ? "border-iris/60 bg-iris/[0.08] shadow-glow"
                      : "border-line bg-base/40",
                    supported && engine !== e && "hover:border-line-strong hover:bg-base"
                  )}
                >
                  <EngineIcon engine={e} size={26} />
                  <span
                    className={cn(
                      "text-2xs font-medium",
                      engine === e ? "text-content" : "text-content-muted"
                    )}
                  >
                    {ENGINE_META[e].label}
                  </span>
                  {!supported && (
                    <span className="text-3xs text-content-faint">em breve</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Nome da conexão">
          <Input
            placeholder={`${meta.label} — Produção`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {isSqlite ? (
          <Field label="Arquivo do banco">
            <Input
              placeholder="~/projeto/app.db"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Host">
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
              </Field>
              <Field label="Porta" className="w-28">
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={String(meta.defaultPort ?? "")}
                />
              </Field>
            </div>
            <Field label="Banco de dados">
              <Input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="app_production"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Usuário">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="postgres"
                />
              </Field>
              <Field label="Senha">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  leading={<Lock size={13} />}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-content-muted">
              <input
                type="checkbox"
                checked={ssl}
                onChange={(e) => setSsl(e.target.checked)}
                className="accent-iris"
              />
              Conexão SSL / TLS
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
