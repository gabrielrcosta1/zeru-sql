import { useEffect, useState } from "react";
import { Sparkles, KeyRound, Check } from "lucide-react";
import type { AiSettings } from "@/lib/api";
import { useApp } from "@/store/app";
import { Modal } from "@/components/ui/Modal";
import { Input, Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/** Ready-made endpoints, so the common cases are one click instead of a lookup. */
const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
];

export function AiSettingsModal() {
  const { aiSettingsOpen, openAiSettings, aiSettings, loadAiSettings, saveAiSettings } =
    useApp();

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  // Empty means "leave the stored key alone" — the backend never returns it,
  // so there is nothing to prefill here.
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (aiSettingsOpen) loadAiSettings();
  }, [aiSettingsOpen, loadAiSettings]);

  // Mirror the loaded settings into the form once they arrive.
  const [syncedFrom, setSyncedFrom] = useState<AiSettings | null>(null);
  if (aiSettings && aiSettings !== syncedFrom) {
    setSyncedFrom(aiSettings);
    setBaseUrl(aiSettings.baseUrl);
    setModel(aiSettings.model);
    setTemperature(aiSettings.temperature?.toString() ?? "");
    setMaxTokens(aiSettings.maxTokens?.toString() ?? "");
    setApiKey("");
    setError(null);
  }

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
  };

  const save = async (clearKey = false) => {
    setSaving(true);
    setError(null);
    try {
      await saveAiSettings(
        {
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          temperature: temperature.trim() === "" ? undefined : Number(temperature),
          maxTokens: maxTokens.trim() === "" ? undefined : Number(maxTokens),
          hasApiKey: aiSettings?.hasApiKey ?? false,
        },
        clearKey ? "" : apiKey.trim() || undefined
      );
      setApiKey("");
      if (!clearKey) openAiSettings(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const valid = baseUrl.trim() !== "" && model.trim() !== "";

  return (
    <Modal
      open={aiSettingsOpen}
      onClose={() => openAiSettings(false)}
      width="max-w-xl"
      icon={
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-iris/15 text-iris">
          <Sparkles size={18} />
        </div>
      }
      title="Assistente de IA"
      subtitle="Qualquer provedor compatível com a API de chat da OpenAI."
      footer={
        <>
          <Button size="sm" variant="subtle" onClick={() => openAiSettings(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!valid || saving}
            onClick={() => save()}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="rounded-full border border-line-strong/60 bg-base/60 px-2.5 py-1 text-2xs text-content-muted transition-colors hover:border-iris/50 hover:text-content"
            >
              {p.label}
            </button>
          ))}
        </div>

        <Field
          label="Endpoint"
          hint="Raiz da API. O caminho /chat/completions é acrescentado automaticamente."
        >
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
          />
        </Field>

        <Field label="Modelo">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            spellCheck={false}
          />
        </Field>

        <Field
          label="Chave de API"
          hint={
            aiSettings?.hasApiKey
              ? "Uma chave já está guardada no keychain do sistema. Deixe em branco para mantê-la."
              : "Guardada no keychain do sistema — nunca é gravada em disco nem exposta à interface."
          }
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={aiSettings?.hasApiKey ? "••••••••" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            leading={<KeyRound size={14} />}
            trailing={
              aiSettings?.hasApiKey && !apiKey ? (
                <Check size={14} className="shrink-0 text-teal" />
              ) : undefined
            }
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperatura" hint="Vazio usa o padrão do provedor.">
            <Input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="0.2"
              inputMode="decimal"
            />
          </Field>
          <Field label="Máximo de tokens">
            <Input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              placeholder="2048"
              inputMode="numeric"
            />
          </Field>
        </div>

        {aiSettings?.hasApiKey && (
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="text-2xs text-rose underline underline-offset-2 hover:text-rose/80 disabled:opacity-50"
          >
            Remover a chave guardada
          </button>
        )}

        {error && (
          <div className="rounded-lg border border-rose/40 bg-rose/[0.06] px-3 py-2 text-xs text-rose">
            {error}
          </div>
        )}

        <p className="text-2xs leading-relaxed text-content-faint">
          O esquema do banco, o SQL da aba aberta e uma amostra do último
          resultado são enviados ao provedor junto da sua pergunta. Use um
          endpoint local se esses dados não puderem sair da máquina.
        </p>
      </div>
    </Modal>
  );
}
