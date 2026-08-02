import { useEffect, useState } from "react";
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
    supabase.from("provinces").select("id,name").eq("country_id", value.country_id).order("name")
      .then(({ data }) => setProvinces((data as Row[]) ?? []));
  }, [value.country_id]);

  useEffect(() => {
    if (!value.province_id) { setMunis([]); return; }
    supabase.from("municipalities").select("id,name").eq("province_id", value.province_id).order("name")
      .then(({ data }) => setMunis((data as Row[]) ?? []));
  }, [value.province_id]);

  useEffect(() => {
    if (!value.municipality_id) { setDistricts([]); return; }
    supabase.from("districts").select("id,name").eq("municipality_id", value.municipality_id).order("name")
      .then(({ data }) => setDistricts((data as Row[]) ?? []));
  }, [value.municipality_id]);

  const req = required ? " *" : "";
  const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

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
      <div className="space-y-1.5">
        <Label className="text-xs">{t("province")}{req}</Label>
        <select
          className={selectCls}
          value={value.province_id}
          disabled={!value.country_id}
          onChange={(e) => onChange({ ...value, province_id: e.target.value, municipality_id: "", district_id: "" })}
        >
          <option value="">{t("select")}</option>
          {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("municipality")}{req}</Label>
        <select
          className={selectCls}
          value={value.municipality_id}
          disabled={!value.province_id}
          onChange={(e) => onChange({ ...value, municipality_id: e.target.value, district_id: "" })}
        >
          <option value="">{t("select")}</option>
          {munis.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {showDistrict && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("district")}</Label>
          <select
            className={selectCls}
            value={value.district_id}
            disabled={!value.municipality_id || districts.length === 0}
            onChange={(e) => onChange({ ...value, district_id: e.target.value })}
          >
            <option value="">{districts.length === 0 ? "—" : t("select")}</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
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