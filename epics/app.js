const I18N = {
  en: {
    title: "Dashboard",
    subtitle: "Arduino → Raspberry Pi · preview",
    language: "Language",
    temperature: "Temperature",
    humidity: "Humidity",
    chart: "Chart",
    yTempStep: "Y temp",
    yHumStep: "Y hum",
    xTicks: "X ticks",
    last: "last",
    points: "points",
    update: "Update",
    autoRefresh: "Auto-refresh",
    refreshNow: "Refresh now",
    port: "Port",
    avgLive: "Averages · live",
    tempHum: "temperature / humidity",
    updated: "Updated",
    extras: "Extras",
    dewAvg: "Dew point",
    absHumAvg: "Abs. humidity",
    currAvg: "Current averages",
    status: "Status",
    age: "Age",
    sensors: "Sensors",
    temp: "Temp",
    hum: "Humidity",
    noData: "no data",
    auto: "Auto",
    every5s: "every 5 s",
    every15s: "every 15 s",
    every1m: "every 1 min",
    every5m: "every 5 min",
    every15m: "every 15 min",
    off: "Off",
    s05: "0.5 s",
    s1: "1 s",
    s2: "2 s",
    s5: "5 s",
    date: "Date",
    live: "Live",
    window: "Window",
    w5m: "5 min",
    w15m: "15 min",
    w1h: "1 hour",
    w6h: "6 hours",
    w24h: "24 hours",
    designedFor: "Designed for",
    avgTemp: "Avg temp",
    avgHumLab: "Avg humidity",
    tempAxis: "Temp",
    humAxis: "Humidity",
  },
  id: {
    title: "Dasbor",
    subtitle: "Arduino → Raspberry Pi · pratinjau",
    language: "Bahasa",
    temperature: "Suhu",
    humidity: "Kelembapan",
    chart: "Grafik",
    yTempStep: "Y suhu",
    yHumStep: "Y kelembapan",
    xTicks: "Tanda X",
    last: "terakhir",
    points: "titik",
    update: "Pembaruan",
    autoRefresh: "Penyegaran otomatis",
    refreshNow: "Segarkan",
    port: "Port",
    avgLive: "Rata-rata · langsung",
    tempHum: "suhu / kelembapan",
    updated: "Diperbarui",
    extras: "Ekstra",
    dewAvg: "Titik embun",
    absHumAvg: "Kelembapan abs.",
    currAvg: "Rata-rata saat ini",
    status: "Status",
    age: "Usia",
    sensors: "Sensor",
    temp: "Suhu",
    hum: "Kelembapan",
    noData: "tidak ada data",
    auto: "Otomatis",
    every5s: "setiap 5 dtk",
    every15s: "setiap 15 dtk",
    every1m: "setiap 1 mnt",
    every5m: "setiap 5 mnt",
    every15m: "setiap 15 mnt",
    off: "Mati",
    s05: "0,5 dtk",
    s1: "1 dtk",
    s2: "2 dtk",
    s5: "5 dtk",
    date: "Tanggal",
    live: "Langsung",
    window: "Jendela",
    w5m: "5 mnt",
    w15m: "15 mnt",
    w1h: "1 jam",
    w6h: "6 jam",
    w24h: "24 jam",
    designedFor: "Dirancang untuk",
    avgTemp: "Rata-rata suhu",
    avgHumLab: "Rata-rata kelembapan",
    tempAxis: "Suhu",
    humAxis: "Kelembapan",
  },
};

const store = (key, value) =>
  value === undefined ? localStorage.getItem(key) : localStorage.setItem(key, value);

const getLang = () => {
  const saved = store("ui.lang");
  if (saved && I18N[saved]) return saved;
  return (navigator.language || "en").toLowerCase().startsWith("id") ? "id" : "en";
};

let lang = getLang();
let tempUnit = store("tempUnit") || "F";
let humUnit = store("humUnit") || "%";
let chart;

const t = (key) => I18N[lang]?.[key] || key;
const tempSymbol = () => (tempUnit === "F" ? "°F" : tempUnit === "C" ? "°C" : "K");
const humSymbol = () => (humUnit === "%" ? "%" : "g/m³");
const blank = (unit) => `--.-- ${unit}`;

const fitSelect = (sel) => {
  if (!sel || sel.type === "date") return;
  const measure = document.createElement("span");
  const cs = getComputedStyle(sel);
  measure.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "white-space:nowrap",
    `font:${cs.font}`,
    `letter-spacing:${cs.letterSpacing}`,
    `text-transform:${cs.textTransform}`,
  ].join(";");
  measure.textContent = sel.options[sel.selectedIndex]?.text || "";
  document.body.appendChild(measure);
  sel.style.width = `${Math.ceil(measure.getBoundingClientRect().width) + 22}px`;
  measure.remove();
};

const fitSelects = () => {
  document.querySelectorAll("select.epics-select").forEach(fitSelect);
};

const applyI18n = () => {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-opt]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n-opt"));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n-alt"));
  });
  renderYTempSelect();
  paintPlaceholders();
  updateChartCopy();
  fitSelects();
};

const renderYTempSelect = () => {
  const sel = document.getElementById("yStepTemp");
  const cur = store("yStepTemp") || "auto";
  sel.innerHTML = ["auto", "0.5", "1", "2", "5"]
    .map((v) => `<option value="${v}">${v === "auto" ? t("auto") : v}</option>`)
    .join("");
  sel.value = cur;
  document.getElementById("yTempUnitBadge").textContent = tempSymbol();
};

const setActive = () => {
  document.querySelectorAll("#tempUnits .epics-chip").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.unit === tempUnit);
  });
  document.querySelectorAll("#humUnits .epics-chip").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.unit === humUnit);
  });
};

const paintPlaceholders = () => {
  const ts = tempSymbol();
  const hs = humSymbol();
  document.getElementById("avgF").textContent = blank(ts);
  document.getElementById("avgH").textContent = blank(hs);
  document.getElementById("dew").textContent = blank(ts);
  document.getElementById("absHum").textContent = blank("g/m³");
  ["t22", "ta", "tb"].forEach((id) => {
    document.getElementById(id).textContent = blank(ts);
  });
  ["h22", "ha", "hb"].forEach((id) => {
    document.getElementById(id).textContent = blank(hs);
  });
};

const updateChartCopy = () => {
  if (!chart) return;
  chart.data.datasets[0].label = t("avgTemp");
  chart.data.datasets[1].label = t("avgHumLab");
  chart.options.scales.y.title.text = `${t("tempAxis")} (${tempSymbol()})`;
  chart.options.scales.y1.title.text = `${t("humAxis")} (${humSymbol()})`;
  const step = store("yStepTemp") || "auto";
  const humStep = store("yStepHum") || "auto";
  chart.options.scales.y.ticks.stepSize = step === "auto" ? undefined : Number(step);
  chart.options.scales.y1.ticks.stepSize =
    humStep === "auto" ? undefined : Number(humStep);
  chart.update("none");
};

const initChart = () => {
  const canvas = document.getElementById("chart");
  if (!window.Chart || !canvas) return;
  const muted = "#9a9288";
  const grid = "rgba(243, 238, 230, 0.08)";
  chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: t("avgTemp"),
          data: [],
          borderColor: "#d4b483",
          yAxisID: "y",
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: t("avgHumLab"),
          data: [],
          borderColor: "#8ea07a",
          yAxisID: "y1",
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: muted, font: { family: "Outfit" } } },
      },
      scales: {
        x: { ticks: { color: muted }, grid: { color: grid } },
        y: {
          position: "left",
          title: { display: true, text: `${t("tempAxis")} (°F)`, color: muted },
          ticks: { color: muted },
          grid: { color: grid },
        },
        y1: {
          position: "right",
          title: { display: true, text: `${t("humAxis")} (%)`, color: muted },
          ticks: { color: muted },
          grid: { display: false },
        },
      },
    },
  });
  updateChartCopy();
};

const syncLive = () => {
  const live = !document.getElementById("datePick").value;
  document.getElementById("btnLive").classList.toggle("is-on", live);
};

document.getElementById("lang").value = lang;
document.getElementById("lang").addEventListener("change", (event) => {
  lang = event.target.value;
  store("ui.lang", lang);
  applyI18n();
  fitSelect(event.target);
});

document.querySelectorAll("#tempUnits .epics-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    tempUnit = btn.dataset.unit;
    store("tempUnit", tempUnit);
    setActive();
    renderYTempSelect();
    paintPlaceholders();
    updateChartCopy();
  });
});

document.querySelectorAll("#humUnits .epics-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    humUnit = btn.dataset.unit;
    store("humUnit", humUnit);
    setActive();
    paintPlaceholders();
    updateChartCopy();
  });
});

["refreshMs", "yStepTemp", "yStepHum", "xTicks", "timeWindow"].forEach((id) => {
  const el = document.getElementById(id);
  const saved = store(id);
  if (saved) el.value = saved;
  el.addEventListener("change", () => {
    store(id, el.value);
    updateChartCopy();
    fitSelect(el);
  });
});

document.getElementById("datePick").addEventListener("change", () => {
  store("selectedDate", document.getElementById("datePick").value);
  syncLive();
});

document.getElementById("btnLive").addEventListener("click", () => {
  document.getElementById("datePick").value = "";
  store("selectedDate", "");
  const defaults = { xTicks: "m:1", yStepTemp: "auto", yStepHum: "auto", timeWindow: "1h" };
  Object.entries(defaults).forEach(([id, value]) => {
    store(id, value);
    document.getElementById(id).value = value;
  });
  renderYTempSelect();
  syncLive();
  updateChartCopy();
});

document.getElementById("refreshNow").addEventListener("click", paintPlaceholders);

if (store("selectedDate")) document.getElementById("datePick").value = store("selectedDate");

setActive();
applyI18n();
syncLive();
initChart();
fitSelects();
