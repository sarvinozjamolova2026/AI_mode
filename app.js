// State management
let currentTab = "tab-dashboard";
let currentMessageFilter = "ALL";
let currentComplaintFilter = "ALL";
let currentPeriod = "all";
let searchDebounceTimer = null;

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  loadDashboard();
  loadRules();
  loadSettings();

  // Auto-refresh stats every 15 seconds
  setInterval(() => {
    if (currentTab === "tab-dashboard") loadDashboard();
    if (currentTab === "tab-stream") loadMessages();
    if (currentTab === "tab-complaints") loadComplaints();
  }, 15000);
});

// Navigation handling
function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === tabId);
  });

  if (tabId === "tab-dashboard") loadDashboard();
  else if (tabId === "tab-stream") loadMessages();
  else if (tabId === "tab-complaints") loadComplaints();
  else if (tabId === "tab-reports") loadReports(currentPeriod);
  else if (tabId === "tab-rules") {
    loadRules();
    loadSettings();
  }
}

// ---------------------------------------------------------------------
// 1. DASHBOARD & KPIS
// ---------------------------------------------------------------------
async function loadDashboard() {
  try {
    const res = await fetch("/api/stats?period=all");
    const data = await res.json();

    const ov = data.overview || {};
    document.getElementById("kpi-total").innerText = ov.total || 0;
    document.getElementById("kpi-approved").innerText = ov.approved || 0;
    document.getElementById("kpi-blocked").innerText = ov.blocked || 0;
    document.getElementById("kpi-flagged").innerText = ov.flagged || 0;
    document.getElementById("kpi-latency").innerHTML = `${ov.avg_latency || 0} <span style="font-size: 1rem; font-weight: normal; color: var(--text-muted);">ms</span>`;

    // Complaints badge in header
    const compCount = data.complaints?.pending || 0;
    const compBadge = document.getElementById("complaints-badge");
    if (compCount > 0) {
      compBadge.innerText = compCount;
      compBadge.style.display = "inline-block";
    } else {
      compBadge.style.display = "none";
    }

    renderTimelineChart(data.timeline || []);
    renderViolationBreakdown(data.violations || {}, ov.total || 1);
    loadRecentDashboardMessages();
  } catch (err) {
    console.error("Dashboard yuklashda xatolik:", err);
  }
}

function renderTimelineChart(timeline) {
  const container = document.getElementById("timeline-chart-container");
  if (!container) return;

  if (!timeline || timeline.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); margin: auto;">Ma'lumotlar mavjud emas</div>`;
    return;
  }

  const maxVal = Math.max(...timeline.map((t) => t.total || 1), 5);
  container.innerHTML = timeline
    .map((item) => {
      const totalHeight = Math.max(15, Math.round((item.total / maxVal) * 180));
      const blockedHeight = Math.round((item.blocked / (item.total || 1)) * totalHeight);
      const dayLabel = item.day ? item.day.slice(5) : "";

      return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end;">
        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">${item.total}</div>
        <div style="width: 100%; max-width: 32px; height: ${totalHeight}px; background: rgba(59, 130, 246, 0.4); border-radius: 6px; position: relative; overflow: hidden;" title="${item.day}: Jami ${item.total}, Bloklangan: ${item.blocked}">
          <div style="position: absolute; bottom: 0; left: 0; right: 0; height: ${blockedHeight}px; background: #ef4444; border-radius: 0 0 6px 6px;"></div>
        </div>
        <div style="font-size: 0.68rem; color: var(--text-secondary); margin-top: 4px;">${dayLabel}</div>
      </div>
    `;
    })
    .join("");
}

function renderViolationBreakdown(violations, total) {
  const container = document.getElementById("violation-breakdown");
  if (!container) return;

  const labels = {
    spam: { name: "Spam va Reklama", color: "#f59e0b" },
    link: { name: "Taqiqlangan Havolalar (URL / Telegram)", color: "#ef4444" },
    insult: { name: "Haqorat va Nojo'ya So'zlar", color: "#ec4899" },
    cta: { name: "Tashqi Chaqiriqlar (CTA)", color: "#8b5cf6" },
  };

  const safeTotal = Math.max(
    Object.values(violations).reduce((a, b) => a + b, 0),
    1
  );

  container.innerHTML = Object.entries(labels)
    .map(([key, meta]) => {
      const count = violations[key] || 0;
      const pct = Math.round((count / safeTotal) * 100);
      return `
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
          <span>${meta.name}</span>
          <span style="font-weight: 600;">${count} ta (${pct}%)</span>
        </div>
        <div style="height: 8px; width: 100%; background: var(--bg-secondary); border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: ${meta.color}; border-radius: 4px; transition: width 0.4s ease;"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

async function loadRecentDashboardMessages() {
  const table = document.getElementById("dashboard-recent-table");
  if (!table) return;

  try {
    const res = await fetch("/api/messages?limit=5");
    const data = await res.json();
    table.innerHTML = (data.items || [])
      .map(
        (m) => `
      <tr>
        <td>#${m.id}</td>
        <td><strong>${escapeHtml(m.author_name || "Anonim")}</strong></td>
        <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(m.original_text)}">
          ${escapeHtml(m.original_text)}
        </td>
        <td>${renderStatusBadge(m.status)}</td>
        <td>${renderRiskPill(m.risk_score)}</td>
        <td style="font-size: 0.78rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(m.explanation_uz || "Qoidaga mos")}
        </td>
        <td style="font-size: 0.75rem; color: var(--text-muted);">${m.created_at || ""}</td>
      </tr>
    `
      )
      .join("");
  } catch (e) {
    console.error(e);
  }
}

// ---------------------------------------------------------------------
// 2. LIVE STREAM & MESSAGE MANAGEMENT
// ---------------------------------------------------------------------
async function loadMessages() {
  const tableBody = document.getElementById("messages-table-body");
  if (!tableBody) return;

  const searchVal = document.getElementById("stream-search")?.value || "";
  let url = `/api/messages?status=${currentMessageFilter}&limit=100`;
  if (searchVal.trim()) url += `&search=${encodeURIComponent(searchVal.trim())}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = data.items || [];

    if (items.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">Hech qanday xabar topilmadi</td></tr>`;
      return;
    }

    tableBody.innerHTML = items
      .map((m) => {
        let violations = [];
        try {
          violations = JSON.parse(m.violations || "[]");
        } catch (_) {}

        return `
        <tr>
          <td><strong>#${m.id}</strong></td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(m.author_name || "Foydalanuvchi")}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(m.user_id || "")}</div>
          </td>
          <td style="max-width: 260px;">
            <div style="font-size: 0.85rem; word-break: break-word;">${escapeHtml(m.original_text)}</div>
          </td>
          <td>
            <span class="badge" style="background: rgba(255,255,255,0.08);">${(m.detected_lang || "uz").toUpperCase()}</span>
          </td>
          <td style="max-width: 260px; font-size: 0.8rem; color: var(--text-secondary);">
            <div>🇺🇿 ${escapeHtml(m.text_uz || m.original_text)}</div>
            <div style="margin-top: 3px; color: #93c5fd;">🇷🇺 ${escapeHtml(m.text_ru || "")}</div>
          </td>
          <td>${renderStatusBadge(m.status)}</td>
          <td>${renderRiskPill(m.risk_score)}</td>
          <td>
            ${
              violations.length > 0
                ? violations.map((v) => `<span class="badge badge-violation">${v}</span>`).join("")
                : '<span style="color: var(--text-muted); font-size: 0.75rem;">—</span>'
            }
          </td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" onclick="openInspectorModal(${m.id})" title="Batafsil tekshirish">🔍</button>
              ${
                m.status !== "APPROVED"
                  ? `<button class="btn btn-success btn-sm" onclick="updateMessageStatus(${m.id}, 'APPROVED')" title="Tasdiqlash">✓</button>`
                  : ""
              }
              ${
                m.status !== "BLOCKED"
                  ? `<button class="btn btn-danger btn-sm" onclick="updateMessageStatus(${m.id}, 'BLOCKED')" title="Bloklash">🚫</button>`
                  : ""
              }
              <button class="btn btn-secondary btn-sm" onclick="openComplaintForMessage(${m.id})" title="Shikoyat qilish">🚨</button>
              <button class="btn btn-secondary btn-sm" onclick="deleteMessage(${m.id})" title="O'chirish" style="color: #ef4444;">🗑️</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");
  } catch (err) {
    console.error("Xabarlarni yuklashda xatolik:", err);
  }
}

function filterMessages(status, btnElement) {
  currentMessageFilter = status;
  btnElement.parentElement.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btnElement.classList.add("active");
  loadMessages();
}

function handleSearch(val) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadMessages();
  }, 350);
}

async function updateMessageStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/messages/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      loadMessages();
      loadDashboard();
    }
  } catch (e) {
    alert("Xatolik yuz berdi: " + e);
  }
}

async function deleteMessage(id) {
  if (!confirm(`Haqiqatan ham #${id} xabarni butunlay o'chirmoqchimisiz?`)) return;
  try {
    const res = await fetch(`/api/messages/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadMessages();
      loadDashboard();
    }
  } catch (e) {
    alert("O'chirishda xatolik: " + e);
  }
}

// ---------------------------------------------------------------------
// 3. LIVE TESTER (Interactive Playground)
// ---------------------------------------------------------------------
const samples = {
  clean: "Assalomu alaykum! Xizmatingiz juda sifatli ekan, barchaga tavsiya qilaman.",
  clean_ru: "Здравствуйте! Подскажите, пожалуйста, до скольких работает служба технической поддержки?",
  telegram_link: "HAMMAGA SALOM! Kuniga 100$ topishni xohlaysizmi? Bizning kanalimizga qo'shiling: https://t.me/tez_daromad",
  masked_url: "Batafsil ma'lumot va arzon narxlar bizning saytimizda: super - shop . uz saytiga kiring!",
  profanity: "Senlar hammang ahmoq, haromi va iflossanlar, ishingni eplolmasang yo'qol!",
  sarcasm: "Voy-bo'o'y, nahotki shunaqa 'aqlli' odamlar bu yerda yig'ilgan bo'lsa? Qoyil daholarga!",
  cta: "Lichkaga yozing, oylik 500$ daromadli referal dasturni o'rgataman, profilimdagi havolaga o'ting.",
};

function setSample(key) {
  const text = samples[key] || "";
  document.getElementById("test-text").value = text;
}

async function runLiveTest() {
  const text = document.getElementById("test-text").value;
  const author = document.getElementById("test-author").value || "Test Foydalanuvchi";
  const btn = document.getElementById("btn-run-test");

  if (!text || !text.trim()) {
    alert("Iltimos, tekshirish uchun matn kiriting!");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `⏳ Tekshirilmoqda...`;

  try {
    const res = await fetch("/api/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        user_id: "interactive_tester",
        author_name: author,
      }),
    });

    const result = await res.json();
    renderTestResult(result);
    loadDashboard();
  } catch (err) {
    alert("Tekshiruv amalga oshmadi: " + err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `🚀 Moderatsiyadan O'tkazish`;
  }
}

function renderTestResult(data) {
  document.getElementById("test-result-empty").style.display = "none";
  const resContent = document.getElementById("test-result-content");
  resContent.style.display = "block";

  const st1 = data.stage_1 || {};
  const st2 = data.stage_2 || {};
  const risk = data.risk_score || 0;

  let riskColor = "#34d399";
  if (risk >= 70) riskColor = "#ef4444";
  else if (risk >= 40) riskColor = "#f59e0b";

  resContent.innerHTML = `
    <!-- Final Verdict Card -->
    <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 1.2rem; margin-bottom: 1.2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
        <div>
          <span style="font-size: 0.8rem; color: var(--text-muted);">YAKUNIY QAROR:</span>
          <div style="margin-top: 3px;">${renderStatusBadge(data.status)}</div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">XAVF DARAJASI:</span>
          <div style="font-size: 1.4rem; font-weight: 700; color: ${riskColor};">${risk}%</div>
        </div>
      </div>

      <!-- Risk meter bar -->
      <div style="height: 8px; width: 100%; background: #111827; border-radius: 4px; overflow: hidden; margin-bottom: 0.8rem;">
        <div style="height: 100%; width: ${risk}%; background: ${riskColor}; transition: width 0.5s ease;"></div>
      </div>

      <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; background: rgba(0,0,0,0.2); padding: 0.6rem 0.85rem; border-radius: 6px;">
        <strong>Izoh:</strong> ${escapeHtml(data.explanation_uz || "Qoidabuzarlik aniqlanmadi")}
      </div>
    </div>

    <!-- 1-BOSQICH (REGEX) -->
    <div style="background: var(--bg-secondary); border-left: 3px solid var(--accent-blue); padding: 0.8rem 1rem; border-radius: 0 8px 8px 0; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 600; color: #60a5fa; margin-bottom: 4px;">
        <span>1-BOSQICH: REGEX & QOIDALAR FILTRI</span>
        <span>${st1.latency_ms || 0} ms</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-secondary);">
        Natija: <strong>${st1.action || "PASS"}</strong> | Topilgan buzilishlar: 
        ${
          st1.violations && st1.violations.length > 0
            ? st1.violations.map((v) => `<span class="badge badge-violation">${v}</span>`).join("")
            : '<span style="color: #34d399;">Yo\'q (Toza)</span>'
        }
      </div>
      ${
        st1.matched_rules && st1.matched_rules.length > 0
          ? `<div style="font-size: 0.75rem; color: #f87171; margin-top: 4px;">Ushlangan qoidalar: ${st1.matched_rules.map((r) => escapeHtml(r)).join(", ")}</div>`
          : ""
      }
    </div>

    <!-- 2-BOSQICH (GEMINI AI) -->
    <div style="background: var(--bg-secondary); border-left: 3px solid var(--accent-purple); padding: 0.8rem 1rem; border-radius: 0 8px 8px 0; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 600; color: #c084fc; margin-bottom: 4px;">
        <span>2-BOSQICH: GEMINI AI SEMANTIK TAHLIL</span>
        <span>${st2.latency_ms || 0} ms</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">
        <div>Holat: <strong>${st2.verdict || "APPROVED"}</strong> | Sentiment: <strong style="color: #60a5fa;">${st2.sentiment || "NEUTRAL"}</strong> | Dvigatel: <code>${st2.engine || "GEMINI_AI"}</code></div>
      </div>
    </div>

    <!-- AVTOMATIK TARJIMA (UZBEK <-> RUSSIAN) -->
    <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem; font-size: 0.82rem;">
      <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">🌐 Avtomatik Ikki Tilli Tarjima:</div>
      <div style="margin-bottom: 0.4rem;"><strong>🇺🇿 O'zbekcha:</strong> ${escapeHtml(data.text_uz || "")}</div>
      <div style="color: #93c5fd;"><strong>🇷🇺 Ruscha:</strong> ${escapeHtml(data.text_ru || "")}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// 4. COMPLAINTS SYSTEM
// ---------------------------------------------------------------------
async function loadComplaints() {
  const tbody = document.getElementById("complaints-table-body");
  if (!tbody) return;

  try {
    const res = await fetch(`/api/complaints?status=${currentComplaintFilter}`);
    const data = await res.json();
    const complaints = data.complaints || [];

    if (complaints.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">Shikoyatlar mavjud emas</td></tr>`;
      return;
    }

    tbody.innerHTML = complaints
      .map((c) => {
        let statusBadge = `<span class="badge badge-flagged">${c.status}</span>`;
        if (c.status === "ACCEPTED") statusBadge = `<span class="badge badge-blocked">QABUL QILINGAN</span>`;
        if (c.status === "REJECTED") statusBadge = `<span class="badge badge-approved">RAD ETILGAN</span>`;

        return `
        <tr>
          <td><strong>#${c.id}</strong></td>
          <td><a href="javascript:void(0)" onclick="openInspectorModal(${c.message_id})">#${c.message_id}</a></td>
          <td>${escapeHtml(c.complainant_name || "Anonim")}</td>
          <td><strong style="color: #f87171;">${escapeHtml(c.reason)}</strong></td>
          <td style="max-width: 200px; font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(c.details || "Izoh yo'q")}</td>
          <td style="max-width: 250px; font-size: 0.82rem;">${escapeHtml(c.original_text || "")}</td>
          <td>${statusBadge}</td>
          <td>
            ${
              c.status === "PENDING"
                ? `
              <div style="display: flex; gap: 4px;">
                <button class="btn btn-danger btn-sm" onclick="resolveComplaint(${c.id}, 'ACCEPT')" title="Qabul qilish va xabarni bloklash">Qabul (Bloklash)</button>
                <button class="btn btn-secondary btn-sm" onclick="resolveComplaint(${c.id}, 'REJECT')" title="Rad etish">Rad etish</button>
              </div>
            `
                : `<span style="font-size: 0.75rem; color: var(--text-muted);">${c.admin_notes || "Ko'rib chiqilgan"}</span>`
            }
          </td>
        </tr>
      `;
      })
      .join("");
  } catch (err) {
    console.error("Shikoyatlarni yuklashda xatolik:", err);
  }
}

function filterComplaints(status, btnElement) {
  currentComplaintFilter = status;
  btnElement.parentElement.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btnElement.classList.add("active");
  loadComplaints();
}

async function resolveComplaint(id, action) {
  const notes = prompt(`Administrator izohi (${action === "ACCEPT" ? "Qabul qilish" : "Rad etish"} sababi):`, action === "ACCEPT" ? "Qoidabuzarlik tasdiqlandi va xabar bloklandi." : "Xabar qoidalarga zid emas.");
  if (notes === null) return;

  try {
    const res = await fetch(`/api/complaints/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, admin_notes: notes }),
    });
    if (res.ok) {
      loadComplaints();
      loadDashboard();
      if (currentTab === "tab-stream") loadMessages();
    }
  } catch (e) {
    alert("Xatolik: " + e);
  }
}

function openComplaintForMessage(msgId) {
  document.getElementById("cmp-msg-id").value = msgId;
  document.getElementById("complaint-modal").classList.add("active");
}

function openNewComplaintModal() {
  document.getElementById("complaint-modal").classList.add("active");
}

function closeComplaintModal() {
  document.getElementById("complaint-modal").classList.remove("active");
}

async function submitNewComplaint() {
  const msgId = document.getElementById("cmp-msg-id").value;
  const author = document.getElementById("cmp-author").value;
  const reason = document.getElementById("cmp-reason").value;
  const details = document.getElementById("cmp-details").value;

  if (!msgId) {
    alert("Xabar ID raqamini kiriting!");
    return;
  }

  try {
    const res = await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: parseInt(msgId),
        complainant_name: author,
        reason: reason,
        details: details,
      }),
    });
    if (res.ok) {
      closeComplaintModal();
      loadComplaints();
      loadDashboard();
      alert("Shikoyat muvaffaqiyatli qabul qilindi!");
    } else {
      const err = await res.json();
      alert("Xatolik: " + err.message);
    }
  } catch (e) {
    alert("Xatolik: " + e);
  }
}

// ---------------------------------------------------------------------
// 5. REPORTS & EXPORTS
// ---------------------------------------------------------------------
async function loadReports(period, btnElement) {
  currentPeriod = period;
  if (btnElement) {
    btnElement.parentElement.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btnElement.classList.add("active");
  }

  try {
    const res = await fetch(`/api/stats?period=${period}`);
    const data = await res.json();

    const ov = data.overview || {};
    document.getElementById("rep-total").innerText = ov.total || 0;
    const ratio = ov.total > 0 ? Math.round((ov.blocked / ov.total) * 100) : 0;
    document.getElementById("rep-block-ratio").innerText = `${ratio}%`;
    document.getElementById("rep-avg-risk").innerText = ov.avg_risk || 0;
    document.getElementById("rep-complaints").innerText = data.complaints?.total_complaints || 0;

    // Sentiments
    const sMap = data.sentiments || {};
    const sContainer = document.getElementById("sentiment-breakdown");
    const sColors = { POSITIVE: "#34d399", NEUTRAL: "#60a5fa", NEGATIVE: "#f59e0b", TOXIC: "#ef4444" };
    const sTotal = Math.max(
      Object.values(sMap).reduce((a, b) => a + b, 0),
      1
    );

    sContainer.innerHTML = Object.entries(sMap)
      .map(([k, v]) => {
        const pct = Math.round((v / sTotal) * 100);
        return `
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
            <span>${k}</span>
            <span>${v} ta (${pct}%)</span>
          </div>
          <div style="height: 8px; width: 100%; background: var(--bg-secondary); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${pct}%; background: ${sColors[k] || "#8b5cf6"};"></div>
          </div>
        </div>
      `;
      })
      .join("");
  } catch (err) {
    console.error("Hisobot yuklashda xatolik:", err);
  }
}

async function exportData(format) {
  try {
    const res = await fetch("/api/messages?limit=1000");
    const data = await res.json();
    const items = data.items || [];

    if (format === "json") {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
      downloadBlob(blob, `moderator_report_${new Date().toISOString().slice(0, 10)}.json`);
    } else {
      // CSV Export
      const headers = ["ID", "User_ID", "Muallif", "Asl_Matn", "Status", "Risk_Score", "Til", "Vaqt"];
      const rows = items.map((m) => [
        m.id,
        `"${(m.user_id || "").replace(/"/g, '""')}"`,
        `"${(m.author_name || "").replace(/"/g, '""')}"`,
        `"${(m.original_text || "").replace(/"/g, '""')}"`,
        m.status,
        m.risk_score,
        m.detected_lang,
        `"${m.created_at || ""}"`,
      ]);

      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      downloadBlob(blob, `moderator_report_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  } catch (err) {
    alert("Eksportda xatolik: " + err);
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------------------------------------------------------------
// 6. RULES & SETTINGS
// ---------------------------------------------------------------------
async function loadRules() {
  const tbody = document.getElementById("rules-table-body");
  if (!tbody) return;

  try {
    const res = await fetch("/api/rules");
    const data = await res.json();
    const rules = data.rules || [];

    tbody.innerHTML = rules
      .map(
        (r) => `
      <tr>
        <td><span class="badge badge-violation">${r.rule_type}</span></td>
        <td><code>${escapeHtml(r.pattern)}</code></td>
        <td><span class="badge ${r.action === "BLOCK" ? "badge-blocked" : "badge-flagged"}">${r.action}</span></td>
        <td>
          <button class="btn btn-sm ${r.is_active ? "btn-success" : "btn-secondary"}" onclick="toggleRule(${r.id})">
            ${r.is_active ? "Faol" : "O'chiq"}
          </button>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="deleteRule(${r.id})" style="color: #ef4444;">🗑️</button>
        </td>
      </tr>
    `
      )
      .join("");
  } catch (err) {
    console.error(err);
  }
}

async function toggleRule(id) {
  await fetch(`/api/rules/${id}/toggle`, { method: "POST" });
  loadRules();
}

async function deleteRule(id) {
  if (!confirm("Qoidani o'chirmoqchimisiz?")) return;
  await fetch(`/api/rules/${id}`, { method: "DELETE" });
  loadRules();
}

function openAddRuleModal() {
  document.getElementById("rule-modal").classList.add("active");
}
function closeRuleModal() {
  document.getElementById("rule-modal").classList.remove("active");
}

async function submitNewRule() {
  const type = document.getElementById("new-rule-type").value;
  const pattern = document.getElementById("new-rule-pattern").value;
  const action = document.getElementById("new-rule-action").value;
  const desc = document.getElementById("new-rule-desc").value;

  if (!pattern) {
    alert("Pattern kiritilishi shart!");
    return;
  }

  try {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rule_type: type,
        pattern: pattern,
        action: action,
        description: desc,
      }),
    });
    if (res.ok) {
      closeRuleModal();
      loadRules();
    }
  } catch (e) {
    alert("Xatolik: " + e);
  }
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.gemini_model) document.getElementById("cfg-gemini-model").value = data.gemini_model;
    if (data.block_threshold) document.getElementById("cfg-block-thresh").value = data.block_threshold;
    if (data.flag_threshold) document.getElementById("cfg-flag-thresh").value = data.flag_threshold;
  } catch (err) {
    console.error(err);
  }
}

async function saveSettings() {
  const key = document.getElementById("cfg-gemini-key").value;
  const model = document.getElementById("cfg-gemini-model").value;
  const block = document.getElementById("cfg-block-thresh").value;
  const flag = document.getElementById("cfg-flag-thresh").value;

  const payload = {
    gemini_model: model,
    block_threshold: block,
    flag_threshold: flag,
  };
  if (key && key.trim()) {
    payload.gemini_api_key = key.trim();
  }

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert("Sozlamalar muvaffaqiyatli saqlandi!");
      document.getElementById("cfg-gemini-key").value = "";
    }
  } catch (e) {
    alert("Saqlashda xatolik: " + e);
  }
}

// ---------------------------------------------------------------------
// 7. INSPECTION MODAL
// ---------------------------------------------------------------------
async function openInspectorModal(msgId) {
  const modal = document.getElementById("inspector-modal");
  const body = document.getElementById("modal-msg-body");
  modal.classList.add("active");
  body.innerHTML = `<div style="text-align: center; padding: 2rem;">Yuklanmoqda...</div>`;

  try {
    const res = await fetch(`/api/messages/${msgId}`);
    const m = await res.json();

    let st1 = {},
      st2 = {},
      violations = [];
    try {
      st1 = JSON.parse(m.stage_1_details || "{}");
    } catch (_) {}
    try {
      st2 = JSON.parse(m.stage_2_details || "{}");
    } catch (_) {}
    try {
      violations = JSON.parse(m.violations || "[]");
    } catch (_) {}

    body.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <div>
          <span style="font-size: 0.8rem; color: var(--text-muted);">XABAR ID:</span> <strong>#${m.id}</strong>
          <span style="margin-left: 0.8rem; font-size: 0.8rem; color: var(--text-muted);">MUALLIF:</span> <strong>${escapeHtml(m.author_name || "Anonim")}</strong> (${escapeHtml(m.user_id || "")})
        </div>
        <div>
          ${renderStatusBadge(m.status)}
          <span style="margin-left: 0.5rem;">${renderRiskPill(m.risk_score)}</span>
        </div>
      </div>

      <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; margin-bottom: 1.2rem;">
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.3rem;">ASL MATN (ORIGINAL):</div>
        <div style="font-size: 0.95rem; font-weight: 500;">${escapeHtml(m.original_text)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1.2rem;">
        <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem;">
          <div style="font-size: 0.75rem; color: #34d399; font-weight: 600; margin-bottom: 0.3rem;">🇺🇿 O'ZBEKCHA TARJIMA:</div>
          <div style="font-size: 0.85rem;">${escapeHtml(m.text_uz || m.original_text)}</div>
        </div>
        <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem;">
          <div style="font-size: 0.75rem; color: #93c5fd; font-weight: 600; margin-bottom: 0.3rem;">🇷🇺 RUSCHA TARJIMA:</div>
          <div style="font-size: 0.85rem;">${escapeHtml(m.text_ru || "")}</div>
        </div>
      </div>

      <div style="background: var(--bg-card); border-left: 4px solid var(--accent-blue); padding: 0.8rem; border-radius: 4px; margin-bottom: 0.8rem;">
        <div style="font-size: 0.82rem; font-weight: 600; color: #60a5fa; margin-bottom: 0.2rem;">1-BOSQICH (REGEX & HEURISTICS):</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          Qaror: <strong>${m.stage_1_verdict || "PASS"}</strong> | Topilgan buzilishlar: ${
      violations.length > 0 ? violations.map((v) => `<span class="badge badge-violation">${v}</span>`).join("") : "Yo'q"
    }
        </div>
        ${
          st1.matched_rules && st1.matched_rules.length > 0
            ? `<div style="font-size: 0.75rem; color: #f87171; margin-top: 4px;">Ushlangan qoidalar: ${st1.matched_rules.map((r) => escapeHtml(r)).join(", ")}</div>`
            : ""
        }
      </div>

      <div style="background: var(--bg-card); border-left: 4px solid var(--accent-purple); padding: 0.8rem; border-radius: 4px; margin-bottom: 1.2rem;">
        <div style="font-size: 0.82rem; font-weight: 600; color: #c084fc; margin-bottom: 0.2rem;">2-BOSQICH (GEMINI AI):</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          Qaror: <strong>${m.stage_2_verdict || "APPROVED"}</strong> | Sentiment: <strong>${m.sentiment || "NEUTRAL"}</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-primary); margin-top: 4px;">
          <strong>Asos (O'zbekcha):</strong> ${escapeHtml(m.explanation_uz || "—")}
        </div>
        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
          <strong>Обоснование (Русский):</strong> ${escapeHtml(m.explanation_ru || "—")}
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-muted);">
          Vaqti: ${m.created_at || ""} | Latency: ${m.latency_ms || 0} ms
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-success" onclick="updateMessageStatus(${m.id}, 'APPROVED'); closeInspectorModal();">Tasdiqlash</button>
          <button class="btn btn-danger" onclick="updateMessageStatus(${m.id}, 'BLOCKED'); closeInspectorModal();">Bloklash</button>
          <button class="btn btn-secondary" onclick="closeInspectorModal();">Yopish</button>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color: #ef4444;">Xatolik: ${err}</div>`;
  }
}

function closeInspectorModal() {
  document.getElementById("inspector-modal").classList.remove("active");
}

// ---------------------------------------------------------------------
// UTILITY HELPERS
// ---------------------------------------------------------------------
function renderStatusBadge(status) {
  if (status === "APPROVED") return `<span class="badge badge-approved">✅ TASDIQLANGAN</span>`;
  if (status === "BLOCKED") return `<span class="badge badge-blocked">🚫 BLOKLANGAN</span>`;
  return `<span class="badge badge-flagged">⚠️ KO'RIB CHIQILMOQDA</span>`;
}

function renderRiskPill(risk) {
  const r = parseInt(risk || 0);
  let cls = "risk-low";
  if (r >= 70) cls = "risk-high";
  else if (r >= 40) cls = "risk-mid";
  return `<span class="risk-pill ${cls}">${r}% xavf</span>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
