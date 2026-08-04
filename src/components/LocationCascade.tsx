import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { regionStore, useRegion } from "@/lib/region";
import { useT } from "@/lib/i18n";

export type LocationValue = {
  country_id: string;
  province_id: string;
  municipality_id: string;
  district_id: string;
};

type Row = { id: string; name: string };

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";

/** Select com pesquisa integrada (necessário para listas grandes: 5k províncias / 150k municípios). */
function SearchSelect({
  label, value, onChange, rows, disabled, loading, placeholder, emptyHint,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  rows: Row[];
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
  emptyHint?: string;
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  useEffect(() => { setQ(""); }, [rows]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;
    return base.slice(0, 300);
  }, [rows, q]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {!disabled && rows.length > 20 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_placeholder")}
          aria-label={label}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      )}
      <select className={selectCls} value={value} disabled={disabled || loading} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {loading ? t("loading") : disabled ? (emptyHint ?? placeholder) : rows.length === 0 ? t("no_results") : placeholder}
        </option>
        {filtered.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </div>
  );
}

type Props = {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  required?: boolean;
  showDistrict?: boolean;
  compact?: boolean;
};

/**
 * Cascading location selector: País → Província → Município → Distrito.
 * Reads real data from countries / provinces / municipalities / districts.
 */
export function LocationCascade({ value, onChange, required, showDistrict = true, compact }: Props) {
  const [countries, setCountries] = useState<Row[]>([]);
  const [provinces, setProvinces] = useState<Row[]>([]);
  const [munis, setMunis] = useState<Row[]>([]);
  const [districts, setDistricts] = useState<Row[]>([]);
  const [loading, setLoading] = useState({ p: false, m: false, d: false });
  const region = useRegion();
  const { t } = useT();

  useEffect(() => {
    supabase.from("countries").select("id,name").eq("active", true).order("name")
      .then(({ data }) => setCountries((data as Row[]) ?? []));
  }, []);

  // Pré-selecciona o país activo da app quando o formulário está vazio.
  useEffect(() => {
    if (!value.country_id && region.id) {
      onChange({ country_id: region.id, province_id: "", municipality_id: "", district_id: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.id]);

  useEffect(() => {
    if (!value.country_id) { setProvinces([]); return; }
    setLoading((s) => ({ ...s, p: true }));
    supabase.from("provinces").select("id,name").eq("country_id", value.country_id).order("name").limit(5000)
      .then(({ data }) => { setProvinces((data as Row[]) ?? []); setLoading((s) => ({ ...s, p: false })); });
  }, [value.country_id]);

  useEffect(() => {
    if (!value.province_id) { setMunis([]); return; }
    setLoading((s) => ({ ...s, m: true }));
    supabase.from("municipalities").select("id,name").eq("province_id", value.province_id).order("name").limit(5000)
      .then(({ data }) => { setMunis((data as Row[]) ?? []); setLoading((s) => ({ ...s, m: false })); });
  }, [value.province_id]);

  useEffect(() => {
    if (!value.municipality_id) { setDistricts([]); return; }
    setLoading((s) => ({ ...s, d: true }));
    supabase.from("districts").select("id,name").eq("municipality_id", value.municipality_id).order("name").limit(2000)
      .then(({ data }) => { setDistricts((data as Row[]) ?? []); setLoading((s) => ({ ...s, d: false })); });
  }, [value.municipality_id]);

  const req = required ? " *" : "";

  return (
    <div className={compact ? "grid grid-cols-2 gap-3" : "space-y-3"}>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("country")}{req}</Label>
        <select
          className={selectCls}
          value={value.country_id}
          onChange={(e) => {
            onChange({ country_id: e.target.value, province_id: "", municipality_id: "", district_id: "" });
            void regionStore.setCountry(e.target.value);
          }}
        >
          <option value="">{t("select")}</option>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <SearchSelect
        label={`${t("province")}${req}`}
        value={value.province_id}
        rows={provinces}
        disabled={!value.country_id}
        loading={loading.p}
        placeholder={t("select")}
        emptyHint={t("select_country_first")}
        onChange={(id) => onChange({ ...value, province_id: id, municipality_id: "", district_id: "" })}
      />
      <SearchSelect
        label={`${t("municipality")}${req}`}
        value={value.municipality_id}
        rows={munis}
        disabled={!value.province_id}
        loading={loading.m}
        placeholder={t("select")}
        emptyHint={t("select_province_first")}
        onChange={(id) => onChange({ ...value, municipality_id: id, district_id: "" })}
      />
      {showDistrict && (
        <SearchSelect
          label={t("district")}
          value={value.district_id}
          rows={districts}
          disabled={!value.municipality_id}
          loading={loading.d}
          placeholder={districts.length === 0 ? "—" : t("select")}
          emptyHint={t("select_municipality_first")}
          onChange={(id) => onChange({ ...value, district_id: id })}
        />
      )}
    </div>
  );
}

/**
 * Small country-only selector used in the profile page.
 * Persists the chosen country to profiles.country_id.
 */
export function CountrySelect({ value, onChange, className }: {
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [countries, setCountries] = useState<Row[]>([]);
  useEffect(() => {
    supabase.from("countries").select("id,name").eq("active", true).order("name")
      .then(({ data }) => setCountries((data as Row[]) ?? []));
  }, []);
  return (
    <select
      className={className ?? "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"}
      value={value ?? ""}
      onChange={(e) => { onChange(e.target.value); void regionStore.setCountry(e.target.value); }}
    >
      <option value="">Selecione o país…</option>
      {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}