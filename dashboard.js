// =====================================================
// إعدادات Supabase
// =====================================================
const SUPABASE_URL = "https://oojinjlzzqfqbcblgrsm.supabase.co";
const SUPABASE_KEY = "sb_publishable_WKICV8R27c87HKTwU9qmkQ_6tiZmjin";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);

let currentProfile = null;
let cachedGroups = [];
let activeGroupId = null;
let activeGroupName = "";
let activeGroupStudents = [];

// =====================================================
// Helpers
// =====================================================
function message(text, type = "info") {
  const n = $("notice");
  if (!n) return;
  $("noticeText").textContent = text;
  n.className = "notice show " + type;
  clearTimeout(message._t);
  message._t = setTimeout(() => n.classList.remove("show"), 7000);
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const arabicMonths = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];
function formatDate(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || "—";
  const [y, m, d] = v.split("-");
  return `${Number(d)} ${arabicMonths[Number(m) - 1] || m} ${y}`;
}

function confirmDialog({ title = "تأكيد", text = "", confirmText = "تأكيد", danger = false } = {}) {
  return new Promise(resolve => {
    const bd = document.createElement("div");
    bd.className = "confirm-backdrop";
    bd.innerHTML = `<section class="confirm-card" role="alertdialog" aria-modal="true">
      <div style="padding:22px 20px"><h2></h2><p></p></div>
      <div class="confirm-actions">
        <button type="button" class="${danger ? "confirm-danger" : "btn primary"}" id="cdYes"></button>
        <button type="button" class="confirm-cancel" id="cdNo">إلغاء</button>
      </div></section>`;
    document.body.appendChild(bd);
    bd.querySelector("h2").textContent = title;
    bd.querySelector("p").textContent = text;
    bd.querySelector("#cdYes").textContent = confirmText;
    const finish = v => { bd.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = e => { if (e.key === "Escape") finish(false); };
    bd.addEventListener("click", e => { if (e.target === bd) finish(false); });
    bd.querySelector("#cdYes").onclick = () => finish(true);
    bd.querySelector("#cdNo").onclick = () => finish(false);
    document.addEventListener("keydown", onKey);
    bd.querySelector("#cdNo").focus();
  });
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let p = "";
  for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// =====================================================
// View switching
// =====================================================
function showView(name) {
  ["overview", "students", "groups", "teachers", "attendanceReports", "statistics"]
    .forEach(v => $(v + "View")?.classList.toggle("hidden", v !== name));

  document.querySelectorAll("[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name));

  const titles = {
    overview: ["نظرة عامة", "ملخص سريع لأداء الأكاديمية"],
    students: ["الطلاب", "إدارة بيانات الطلاب"],
    groups: [currentProfile?.role === "teacher" ? "حلقاتي" : "الحلقات", ""],
    teachers: ["المعلمون", "إدارة حسابات المعلمين"],
    attendanceReports: ["تقارير الحضور", "عرض سجلات الحضور والغياب"],
    statistics: ["الإحصائيات", "إحصائيات المعلمين والحلقات"],
  };
  const [t, s] = titles[name] || ["لوحة التحكم", ""];
  $("pageTitle").textContent = t;
  $("pageSub").textContent = s;

  if (name === "overview") loadOverview();
  if (name === "students") loadStudents();
  if (name === "groups") loadGroups();
  if (name === "teachers") loadTeachers();
  if (name === "attendanceReports") loadAttendanceReportOptions();
  if (name === "statistics") loadStatistics();
}

// =====================================================
// Authentication
// =====================================================
async function requireProfile() {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) {
    window.location.replace("./index.html");
    return false;
  }

  const { data: profile, error: pe } = await db
    .from("profiles")
    .select("role, is_active, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (pe || !profile || !profile.is_active ||
      !["manager", "teacher"].includes(profile.role)) {
    await db.auth.signOut();
    window.location.replace("./index.html");
    return false;
  }

  currentProfile = { ...profile, id: user.id, email: user.email };
  $("sidebarWelcome").textContent =
    `مرحبًا ${profile.full_name || user.email} — ${profile.role === "manager" ? "مدير" : "معلم"}`;

  if (profile.role === "teacher") {
    $("navTeachers")?.classList.add("hidden");
    $("navStats")?.classList.add("hidden");
    const gNav = $("groupsNav");
    if (gNav) gNav.innerHTML = '<i class="fa-solid fa-layer-group"></i> حلقاتي';
    // إخفاء فلتر المعلمين عن المعلم
    const teacherFilter = $("manageTeacherFilter");
    if (teacherFilter) teacherFilter.style.display = "none";
  }

  return true;
}

// =====================================================
// Groups helpers
// =====================================================
async function loadGroupsCache() {
  const { data, error } = await db.from("groups").select("id, name, teacher_id").order("name");
  if (error) { message("تعذر تحميل الحلقات: " + error.message, "error"); return []; }
  cachedGroups = data || [];
  return cachedGroups;
}

function fillGroupSelects() {
  const selects = ["newStudentGroup", "studentGroupFilter", "reportGroupFilter", "manageStudentGroup"];
  const visible = currentProfile?.role === "teacher"
    ? cachedGroups.filter(g => g.teacher_id === currentProfile.id)
    : cachedGroups;

  selects.forEach(id => {
    const el = $(id);
    if (!el) return;
    const prev = el.value;
    const isFilter = id === "studentGroupFilter" || id === "reportGroupFilter";
    const isManage = id === "manageStudentGroup";
    let html = "";
    if (isFilter) html = `<option value="">اختر الحلقة</option><option value="all">كل الحلقات</option>`;
    else if (isManage) html = `<option value="">كل الحلقات</option><option value="__unassigned__">بدون حلقة</option>`;
    else html = `<option value="">بدون حلقة</option>`;
    html += visible.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name || "حلقة")}</option>`).join("");
    el.innerHTML = html;
    if ([...el.options].some(o => o.value === prev)) el.value = prev;
  });
}

// =====================================================
// تحميل قائمة المعلمين في فلتر الحلقات (للمدير فقط)
// =====================================================
async function loadTeachersForFilter() {
  const sel = $("manageTeacherFilter");
  if (!sel) return;
  if (currentProfile?.role !== "manager") {
    sel.style.display = "none";
    return;
  }
  sel.style.display = "";

  const { data, error } = await db.from("profiles")
    .select("id, full_name")
    .eq("role", "teacher")
    .order("full_name");

  if (error) return;

  const prev = sel.value;
  sel.innerHTML = '<option value="">كل المعلمين</option>' +
    (data || []).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.full_name || "معلم")}</option>`).join("");
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// =====================================================
// Refresh active group (بعد إضافة/تعديل/حذف طالب)
// =====================================================
async function refreshActiveGroup() {
  if (!activeGroupId) return;
  const { data } = await db.from("students")
    .select("id, full_name, birth_date, residence, phone")
    .eq("group_id", activeGroupId)
    .order("full_name");
  if (!data) return;
  activeGroupStudents = data;
  $("groupDetailSubtitle").textContent = `${activeGroupStudents.length} طالب`;
  renderGroupStudents(activeGroupStudents);
  loadAttendance();
}

// =====================================================
// Overview
// =====================================================
async function loadOverview() {
  if (!currentProfile) return;

  // ====== للمدير: كل البيانات ======
  if (currentProfile.role === "manager") {
    const [s, g, t] = await Promise.all([
      db.from("students").select("id", { count: "exact", head: true }),
      db.from("groups").select("id", { count: "exact", head: true }),
      db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher")
    ]);
    if (!s.error) $("studentsCount").textContent = s.count ?? 0;
    if (!g.error) $("groupsCount").textContent = g.count ?? 0;
    if (!t.error) $("teachersCount").textContent = t.count ?? 0;
    return;
  }

  // ====== للمعلم: طلابه وحلقاته فقط + التاريخ ======

  // 1. حلقات المعلم
  const { data: myGroups } = await db
    .from("groups")
    .select("id")
    .eq("teacher_id", currentProfile.id);

  const groupIds = (myGroups || []).map(g => g.id);

  // 2. عدد الحلقات
  $("groupsCount").textContent = groupIds.length;

  // 3. عدد الطلاب في حلقاته
  if (groupIds.length > 0) {
    const { count, error: sErr } = await db
      .from("students")
      .select("id", { count: "exact", head: true })
      .in("group_id", groupIds);
    $("studentsCount").textContent = sErr ? "—" : (count ?? 0);
  } else {
    $("studentsCount").textContent = "0";
  }

  // 4. بطاقة "حسابات المعلمين" → تحويلها إلى "تاريخ اليوم"
  const teacherCard = $("teachersCount");
  if (teacherCard) {
    const label = teacherCard.parentElement.querySelector(".metric-label");
    if (label) label.textContent = "تاريخ اليوم";

    const now = new Date();
    const gregorian = now.toLocaleDateString("ar-EG", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    let hijri = "";
    try {
      hijri = now.toLocaleDateString("ar-SA-u-ca-islamic", {
        year: "numeric", month: "long", day: "numeric"
      });
    } catch {}

    teacherCard.style.fontSize = "15px";
    teacherCard.style.lineHeight = "1.5";
    teacherCard.style.fontWeight = "700";
    teacherCard.style.display = "flex";
    teacherCard.style.flexDirection = "column";
    teacherCard.style.gap = "4px";

    teacherCard.innerHTML = `
      <span style="color:var(--navy);font-size:14px">${escapeHtml(gregorian)}</span>
      ${hijri ? `<span style="color:var(--teal-dark);font-size:13px">${escapeHtml(hijri)} هـ</span>` : ""}
    `;
  }
}

// =====================================================
// Students
// =====================================================
async function loadStudents() {
  const tbody = $("studentsRows");
  const selected = $("studentGroupFilter").value;
  const search = $("studentSearch").value.trim();

  if (!selected && !search) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">اختر الحلقة أو أدخل اسم الطالب للبحث.</td></tr>';
    if (activeGroupId) await refreshActiveGroup();
    return;
  }

  tbody.innerHTML = '<tr><td colspan="9" class="empty">جارٍ التحميل...</td></tr>';
  let q = db.from("students")
    .select("id, full_name, group_id, group_type, registration_date, created_by, notes, gender, birth_date, residence, phone, created_at")
    .order("created_at", { ascending: false }).limit(200);

  if (search) q = q.ilike("full_name", "%" + search + "%");
  if (selected && selected !== "all") q = q.eq("group_id", selected);

  const { data, error } = await q;
  if (error) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">تعذر تحميل الطلاب.</td></tr>';
    message("تعذر تحميل الطلاب: " + error.message, "error");
    return;
  }

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">لا يوجد طلاب.</td></tr>';
    if (activeGroupId) await refreshActiveGroup();
    return;
  }

  const groupMap = Object.fromEntries(cachedGroups.map(g => [g.id, g.name]));
  window.__studentsMap = Object.fromEntries(data.map(s => [s.id, s]));

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${escapeHtml(r.full_name || "—")}</td>
      <td>${escapeHtml(formatDate(r.birth_date))}</td>
      <td>${escapeHtml(r.residence || "—")}</td>
      <td>${escapeHtml(r.phone || "—")}</td>
      <td>${r.gender === "male" ? '<span class="tag">ذكر</span>' : r.gender === "female" ? '<span class="group-pill">أنثى</span>' : '<span class="group-pill unassigned">—</span>'}</td>
      <td><span class="group-pill ${r.group_id ? "" : "unassigned"}">${escapeHtml(r.group_id ? (groupMap[r.group_id] || "—") : "بدون حلقة")}</span></td>
      <td>${escapeHtml(r.group_type || "—")}</td>
      <td>${escapeHtml(formatDate(r.registration_date))}</td>
      <td>${escapeHtml(r.notes || "—")}</td>
    </tr>`).join("");

  if (activeGroupId) await refreshActiveGroup();
}

// =====================================================
// Add student
// =====================================================
function setAddStudentModal(open) {
  const m = $("addStudentBackdrop");
  m.classList.toggle("hidden", !open);
  m.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
  if (open) setTimeout(() => $("newStudentName").focus(), 50);
}

async function addStudent(e) {
  e.preventDefault();
  const btn = $("addStudentBtn");
  const name = $("newStudentName").value.trim();
  if (!name) { message("اسم الطالب مطلوب.", "error"); return; }

  btn.disabled = true;
  btn.textContent = "جارٍ الحفظ...";

  const student = {
    full_name: name,
    group_id: $("newStudentGroup").value || null,
    group_type: $("newStudentGroupType").value.trim() || null,
    registration_date: $("newStudentRegistrationDate").value || null,
    gender: $("newStudentGender").value || null,
    birth_date: $("newStudentBirthDate").value || null,
    residence: $("newStudentResidence").value.trim() || null,
    phone: $("newStudentPhone").value.trim() || null,
    notes: $("newStudentNotes").value.trim() || null,
    created_by: currentProfile.id
  };

  const { error } = await db.from("students").insert(student);
  btn.disabled = false;
  btn.textContent = "حفظ الطالب";

  if (error) {
    message("تعذر حفظ الطالب: " + error.message, "error");
    return;
  }

  $("addStudentForm").reset();
  setAddStudentModal(false);
  message("تمت إضافة الطالب بنجاح.", "success");
  await loadStudents();
  loadOverview();
}

// =====================================================
// Manage students
// =====================================================
function setStudentManageModal(open) {
  const m = $("studentManageBackdrop");
  m.classList.toggle("hidden", !open);
  m.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
}

async function refreshManageStudents() {
  const groupId = $("manageStudentGroup").value;
  const sel = $("manageStudentSelect");
  sel.disabled = true;
  sel.innerHTML = '<option value="">جارٍ التحميل...</option>';

  let q = db.from("students")
    .select("id, full_name, group_id, group_type, registration_date, created_by, gender, birth_date, residence, phone, notes")
    .order("full_name").limit(500);

  if (groupId === "__unassigned__") q = q.is("group_id", null);
  else if (groupId) q = q.eq("group_id", groupId);

  const { data, error } = await q;
  if (error) { sel.innerHTML = '<option value="">تعذر التحميل</option>'; return; }

  let rows = data || [];
  if (currentProfile.role === "teacher") {
    const ownGroupIds = new Set(cachedGroups.filter(g => g.teacher_id === currentProfile.id).map(g => g.id));
    rows = rows.filter(r => (r.group_id && ownGroupIds.has(r.group_id)) || (!r.group_id && r.created_by === currentProfile.id));
  }

  window.__manageStudentsMap = Object.fromEntries(rows.map(r => [r.id, r]));
  sel.innerHTML = '<option value="">اختر الطالب</option>' +
    rows.map(r => {
      const gname = r.group_id ? (cachedGroups.find(g => g.id === r.group_id)?.name || "—") : "بدون حلقة";
      return `<option value="${escapeHtml(r.id)}">${escapeHtml(r.full_name || "بلا اسم")} · ${escapeHtml(gname)}</option>`;
    }).join("");
  if (!rows.length) sel.innerHTML = '<option value="">لا يوجد طلاب</option>';
  sel.disabled = false;
}

function updateManageActions() {
  const id = $("manageStudentSelect").value;
  const row = window.__manageStudentsMap?.[id];
  $("manageEditStudent").classList.toggle("hidden", !row);
  $("manageDeleteStudent").classList.toggle("hidden", !row);
  $("manageStudentStatus").textContent = row
    ? `الطالب المحدد: ${row.full_name || "بلا اسم"}`
    : "اختر الحلقة ثم الطالب.";
}

// =====================================================
// Edit student
// =====================================================
function openStudentEdit(row) {
  $("editingStudentId").value = row.id;
  $("editStudentName").value = row.full_name || "";
  $("editStudentGender").value = row.gender || "";
  $("editStudentBirthDate").value = row.birth_date || "";
  $("editStudentResidence").value = row.residence || "";
  $("editStudentPhone").value = row.phone || "";
  $("editStudentGroupType").value = row.group_type || "";
  $("editStudentRegistrationDate").value = row.registration_date || "";
  $("editStudentNotes").value = row.notes || "";

  const sel = $("editStudentGroup");
  sel.innerHTML = '<option value="">بدون حلقة</option>' +
    cachedGroups
      .filter(g => currentProfile.role === "manager" || g.teacher_id === currentProfile.id)
      .map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
  sel.value = row.group_id || "";

  $("studentEditStatus").textContent = "";
  $("studentSaveState").textContent = "راجع البيانات قبل الحفظ.";
  $("studentEditBackdrop").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

async function saveStudentEdit(e) {
  e.preventDefault();
  const btn = $("saveStudentChanges");
  const id = $("editingStudentId").value;
  const name = $("editStudentName").value.trim();
  if (!name) { message("اسم الطالب مطلوب.", "error"); return; }

  btn.disabled = true;
  btn.textContent = "جارٍ الحفظ...";

  const updates = {
    full_name: name,
    group_id: $("editStudentGroup").value || null,
    group_type: $("editStudentGroupType").value.trim() || null,
    registration_date: $("editStudentRegistrationDate").value || null,
    gender: $("editStudentGender").value || null,
    birth_date: $("editStudentBirthDate").value || null,
    residence: $("editStudentResidence").value.trim() || null,
    phone: $("editStudentPhone").value.trim() || null,
    notes: $("editStudentNotes").value.trim() || null
  };

  const { data, error } = await db.from("students").update(updates).eq("id", id).select("id");
  btn.disabled = false;
  btn.textContent = "حفظ";

  if (error) {
    $("studentEditStatus").textContent = "تعذر الحفظ: " + error.message;
    return;
  }
  if (!data?.length) {
    $("studentEditStatus").textContent = "لم يتم التحديث — تحقق من الصلاحيات.";
    return;
  }

  $("studentEditBackdrop").classList.add("hidden");
  document.body.classList.remove("modal-open");
  message("تم حفظ التعديلات.", "success");
  await loadStudents();
}

// =====================================================
// Delete student
// =====================================================
async function deleteStudent() {
  const id = $("manageStudentSelect").value;
  const row = window.__manageStudentsMap?.[id];
  if (!row) { message("اختر طالبًا أولاً.", "error"); return; }

  if (!await confirmDialog({
    title: "حذف الطالب",
    text: `هل تريد حذف «${row.full_name || "الطالب"}» نهائيًا؟`,
    confirmText: "نعم، احذف",
    danger: true
  })) return;

  const { data, error } = await db.from("students").delete().eq("id", id).select("id");
  if (error) { message("تعذر الحذف: " + error.message, "error"); return; }
  if (!data?.length) { message("لم يتم الحذف — تحقق من الصلاحيات.", "error"); return; }

  setStudentManageModal(false);
  message("تم حذف الطالب.", "success");
  await loadStudents();
  loadOverview();
}

// =====================================================
// Transfer student
// =====================================================
function setTransferModal(open) {
  const m = $("transferStudentBackdrop");
  m.classList.toggle("hidden", !open);
  m.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
  if (!open) {
    $("transferStudentForm").reset();
    $("transferStudentSelect").innerHTML = '<option value="">اختر الحلقة أولاً</option>';
    $("transferStudentSelect").disabled = true;
  }
}

async function openTransferModal() {
  setTransferModal(true);
  const groups = currentProfile.role === "teacher"
    ? cachedGroups.filter(g => g.teacher_id === currentProfile.id)
    : cachedGroups;

  const opts = groups.map(g =>
    `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");

  $("transferFromGroup").innerHTML =
    '<option value="">اختر</option><option value="__unassigned__">بدون حلقة</option>' + opts;
  $("transferToGroup").innerHTML = '<option value="">اختر</option>' + opts;
}

async function loadTransferStudents() {
  const from = $("transferFromGroup").value;
  const sel = $("transferStudentSelect");
  sel.disabled = true;
  sel.innerHTML = '<option value="">جارٍ التحميل...</option>';
  if (!from) { sel.innerHTML = '<option value="">اختر الحلقة أولاً</option>'; return; }

  let q = db.from("students").select("id, full_name, created_by, group_id").order("full_name");
  if (from === "__unassigned__") {
    q = q.is("group_id", null);
    if (currentProfile.role === "teacher") q = q.eq("created_by", currentProfile.id);
  } else {
    q = q.eq("group_id", from);
  }

  const { data, error } = await q;
  if (error) { sel.innerHTML = '<option value="">تعذر التحميل</option>'; return; }

  sel.innerHTML = '<option value="">اختر الطالب</option>' +
    (data || []).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name || "بلا اسم")}</option>`).join("");
  if (!data?.length) sel.innerHTML = '<option value="">لا يوجد طلاب</option>';
  sel.disabled = false;
}

async function saveTransfer(e) {
  e.preventDefault();
  const from = $("transferFromGroup").value;
  const sid = $("transferStudentSelect").value;
  const to = $("transferToGroup").value;

  if (!from || !sid || !to) { message("اختر الحلقة والطالب والوجهة.", "error"); return; }
  if (from !== "__unassigned__" && from === to) { message("اختر حلقة مختلفة.", "error"); return; }

  const btn = $("saveTransferStudentBtn");
  btn.disabled = true;
  btn.textContent = "جارٍ النقل...";

  const { data, error } = await db.from("students").update({ group_id: to }).eq("id", sid).select("id, group_id");
  btn.disabled = false;
  btn.textContent = "تأكيد النقل";

  if (error) { message("تعذر النقل: " + error.message, "error"); return; }
  if (!data?.length) { message("لم يتم النقل — تحقق من الصلاحيات.", "error"); return; }

  setTransferModal(false);
  message("تم نقل الطالب بنجاح.", "success");
  await loadStudents();
}

// =====================================================
// Groups
// =====================================================
async function loadGroups() {
  const container = $("groupsRows");
  if (!container) return;
  container.innerHTML = '<div class="empty">جارٍ التحميل...</div>';

  const { data, error } = await db.from("groups")
    .select("id, name, teacher_id, logo_url, group_type")
    .order("name");

  if (error) {
    container.innerHTML = '<div class="empty">تعذر تحميل الحلقات.</div>';
    message(error.message, "error");
    return;
  }

  cachedGroups = data || [];

  // فلترة حسب المعلم المختار (للمدير فقط)
  const teacherFilterValue = $("manageTeacherFilter")?.value || "";
  let displayedGroups = cachedGroups;
  if (currentProfile.role === "manager" && teacherFilterValue) {
    displayedGroups = cachedGroups.filter(g => g.teacher_id === teacherFilterValue);
  }

  fillGroupSelects();
  $("visibleGroupsCount").textContent = `${displayedGroups.length} حلقة`;

  if (!displayedGroups.length) {
    container.innerHTML = '<div class="empty">لا توجد حلقات.</div>';
    const manageSel = $("manageGroupSelect");
    if (manageSel) {
      manageSel.innerHTML = '<option value="">اختر الحلقة التي تريد إدارتها</option>';
      updateManageGroupButtons();
    }
    return;
  }

  const teacherIds = [...new Set(cachedGroups.map(g => g.teacher_id).filter(Boolean))];
  let names = {};
  if (teacherIds.length) {
    const { data: ts } = await db.from("profiles").select("id, full_name").in("id", teacherIds);
    names = Object.fromEntries((ts || []).map(t => [t.id, t.full_name || "معلم"]));
  }

  const groupIds = cachedGroups.map(g => g.id);
  const { data: students } = await db.from("students").select("group_id").in("group_id", groupIds);
  const counts = {};
  (students || []).forEach(s => { if (s.group_id) counts[s.group_id] = (counts[s.group_id] || 0) + 1; });

  container.innerHTML = displayedGroups.map(g => {
    const cnt = counts[g.id] || 0;
    const teacher = names[g.teacher_id] || "غير مسند";
    const icon = g.logo_url && !g.logo_url.startsWith("emoji:")
      ? `<img class="group-icon" src="${escapeHtml(g.logo_url)}" alt="" style="object-fit:cover">`
      : `<div class="group-icon" aria-hidden="true">${escapeHtml(g.logo_url?.slice(6) || "✦")}</div>`;
    return `<article class="group-card">
      <div class="group-card-head">
        ${icon}
        <div class="group-title-wrap">
          <h3 class="group-title">${escapeHtml(g.name || "حلقة")}</h3>
          <div class="group-meta">
            <span>${escapeHtml(teacher)}</span>
            <span aria-hidden="true">•</span>
            <span>${escapeHtml(g.group_type || "غير محدد")}</span>
          </div>
        </div>
      </div>
      <div class="group-card-actions">
        <span class="group-count">${cnt} ${cnt === 1 ? "طالب" : "طلاب"}</span>
        <button class="group-view-btn" type="button" data-view-group="${escapeHtml(g.id)}" data-group-name="${escapeHtml(g.name || "حلقة")}">عرض الحلقة</button>
      </div>
    </article>`;
  }).join("");

  const manageSel = $("manageGroupSelect");
  if (manageSel) {
    const prev = manageSel.value;
    manageSel.innerHTML = '<option value="">اختر الحلقة التي تريد إدارتها</option>' +
      displayedGroups
        .filter(g => currentProfile.role === "manager" || g.teacher_id === currentProfile.id)
        .map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name || "حلقة")}</option>`)
        .join("");
    if ([...manageSel.options].some(o => o.value === prev)) manageSel.value = prev;
    updateManageGroupButtons();
  }
}

function updateManageGroupButtons() {
  const sel = $("manageGroupSelect");
  const editBtn = $("manageEditGroupBtn");
  const delBtn = $("manageDeleteGroupBtn");
  if (!sel || !editBtn || !delBtn) return;

  const group = cachedGroups.find(g => g.id === sel.value);
  const canEdit = !!group;
  const canDelete = !!group && (currentProfile.role === "manager" || group.teacher_id === currentProfile.id);

  editBtn.disabled = !canEdit;
  delBtn.disabled = !canDelete;
}

function openEditGroupModal(id) {
  const group = cachedGroups.find(g => g.id === id);
  if (!group) { message("الحلقة غير موجودة.", "error"); return; }

  if (currentProfile.role !== "manager" && group.teacher_id !== currentProfile.id) {
    message("يمكنك تعديل حلقاتك فقط.", "error");
    return;
  }

  $("editingGroupId").value = group.id;
  $("editGroupName").value = group.name || "";
  $("editGroupType").value = group.group_type || "";
  $("editGroupLogo").value = group.logo_url && !group.logo_url.startsWith("emoji:") ? group.logo_url : "";
  $("editGroupStatus").textContent = "";

  $("editGroupBackdrop").classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => $("editGroupName").focus(), 50);
}

async function saveGroupEdit(e) {
  e.preventDefault();
  const id = $("editingGroupId").value;
  const name = $("editGroupName").value.trim();
  const type = $("editGroupType").value.trim();
  const logo = $("editGroupLogo").value.trim();
  const status = $("editGroupStatus");

  if (!id) { status.textContent = "خطأ: الحلقة غير محددة."; return; }
  if (!name) { status.textContent = "اسم الحلقة مطلوب."; return; }
  if (!type) { status.textContent = "نوع الحلقة مطلوب."; return; }

  const btn = $("saveEditGroupBtn");
  btn.disabled = true;
  btn.textContent = "جارٍ الحفظ...";

  const { data, error } = await db.from("groups").update({
    name,
    group_type: type,
    logo_url: logo || null
  }).eq("id", id).select("id");

  btn.disabled = false;
  btn.textContent = "حفظ";

  if (error) { status.textContent = "خطأ: " + error.message; return; }
  if (!data?.length) { status.textContent = "لم يتم التعديل — تحقق من الصلاحيات."; return; }

  $("editGroupBackdrop").classList.add("hidden");
  document.body.classList.remove("modal-open");
  message("تم تعديل الحلقة.", "success");
  loadGroups();
}

async function openGroupDetail(id, name) {
  activeGroupId = id;
  activeGroupName = name;
  $("groupsListPanel").classList.add("hidden");
  $("groupDetailView").classList.remove("hidden");
  $("groupDetailName").textContent = name;
  $("groupDetailSubtitle").textContent = "جارٍ التحميل...";
  $("groupStudentsRows").innerHTML = '<tr><td colspan="5" class="empty">جارٍ التحميل...</td></tr>';

  const { data, error } = await db.from("students")
    .select("id, full_name, birth_date, residence, phone")
    .eq("group_id", id).order("full_name");

  if (error) {
    $("groupStudentsRows").innerHTML = '<tr><td colspan="5" class="empty">تعذر التحميل.</td></tr>';
    return;
  }
  activeGroupStudents = data || [];
  $("groupDetailSubtitle").textContent = `${activeGroupStudents.length} طالب`;
  renderGroupStudents(activeGroupStudents);

  if (!$("attendanceDate").value) $("attendanceDate").value = todayISO();
  loadAttendance();
}

function renderGroupStudents(students) {
  const tbody = $("groupStudentsRows");
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">لا يوجد طلاب.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td><span class="group-student-row-number">${i + 1}</span></td>
      <td>${escapeHtml(s.full_name || "—")}</td>
      <td>${escapeHtml(formatDate(s.birth_date))}</td>
      <td>${escapeHtml(s.residence || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
    </tr>`).join("");
}

// =====================================================
// Attendance
// =====================================================
async function loadAttendance() {
  if (!activeGroupId) return;
  const date = $("attendanceDate").value || todayISO();
  $("attendanceDate").value = date;

  const tbody = $("attendanceRows");
  if (!activeGroupStudents.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">لا يوجد طلاب.</td></tr>';
    return;
  }

  tbody.innerHTML = activeGroupStudents.map((s, i) => `
    <tr data-student="${escapeHtml(s.id)}">
      <td><span class="group-student-row-number">${i + 1}</span></td>
      <td>${escapeHtml(s.full_name || "—")}</td>
      <td><select class="att-status"><option value="present">حاضر</option><option value="absent">غائب</option><option value="excused">غياب بعذر</option></select></td>
      <td><textarea class="att-ach" maxlength="2000" rows="2" placeholder="إنجازات"></textarea></td>
      <td><textarea class="att-note" maxlength="2000" rows="2" placeholder="ملاحظات"></textarea></td>
    </tr>`).join("");

  const { data, error } = await db.from("attendance_records")
    .select("student_id, status, achievements, note")
    .eq("group_id", activeGroupId).eq("attendance_date", date);

  if (error) return;

  const map = new Map((data || []).map(r => [r.student_id, r]));
  document.querySelectorAll("#attendanceRows tr[data-student]").forEach(tr => {
    const r = map.get(tr.dataset.student);
    if (r) {
      tr.querySelector(".att-status").value = r.status;
      tr.querySelector(".att-ach").value = r.achievements || "";
      tr.querySelector(".att-note").value = r.note || "";
    }
  });
}

async function saveAttendance() {
  if (!activeGroupId) { message("افتح حلقة أولاً.", "error"); return; }
  const date = $("attendanceDate").value;
  if (!date) { message("اختر تاريخًا.", "error"); return; }

  const rows = [...document.querySelectorAll("#attendanceRows tr[data-student]")];
  if (!rows.length) { message("لا يوجد طلاب.", "error"); return; }

  const records = rows.map(tr => ({
    student_id: tr.dataset.student,
    group_id: activeGroupId,
    attendance_date: date,
    status: tr.querySelector(".att-status").value,
    achievements: tr.querySelector(".att-ach").value.trim() || null,
    note: tr.querySelector(".att-note").value.trim() || null,
    marked_by: currentProfile.id
  }));

  const btn = $("saveAttendanceBtn");
  btn.disabled = true;
  btn.textContent = "جارٍ الحفظ...";

  const { error } = await db.from("attendance_records")
    .upsert(records, { onConflict: "student_id,attendance_date" });

  btn.disabled = false;
  btn.textContent = "حفظ الحضور";

  if (error) { message("تعذر الحفظ: " + error.message, "error"); return; }
  message("تم حفظ الحضور.", "success");
}

async function exportCSV() {
  if (!activeGroupId) { message("افتح حلقة أولاً.", "error"); return; }
  const month = $("attendanceExportMonth").value || ($("attendanceDate").value || todayISO()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) { message("اختر شهرًا صحيحًا.", "error"); return; }

  const start = month + "-01";
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1).toISOString().slice(0, 10);

  const { data, error } = await db.from("attendance_records")
    .select("student_id, attendance_date, status, achievements, note")
    .eq("group_id", activeGroupId)
    .gte("attendance_date", start).lt("attendance_date", end)
    .order("attendance_date");

  if (error) { message("تعذر التصدير: " + error.message, "error"); return; }
  if (!data?.length) { message("لا يوجد سجلات لهذا الشهر.", "error"); return; }

  const names = new Map(activeGroupStudents.map(s => [s.id, s.full_name]));
  const labels = { present: "حاضر", absent: "غائب", excused: "غياب بعذر" };

  const rows = data.map(r => ({
    "التاريخ": r.attendance_date,
    "اسم الطالب": names.get(r.student_id) || "—",
    "حالة الحضور": labels[r.status] || r.status,
    "الإنجازات": r.achievements || "",
    "ملاحظات": r.note || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 30 }, { wch: 30 }
  ];

  if (!ws["!views"]) ws["!views"] = [];
  ws["!views"].push({ RTL: true });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الحضور");

  const safeName = (activeGroupName || "حلقة").trim().replace(/[\\/:*?"<>|]/g, "-");
  const fileName = `حضور-${safeName}-${month}.xlsx`;

  XLSX.writeFile(wb, fileName);
  message("تم تصدير ملف Excel بنجاح.", "success");
}

// =====================================================
// Reset month (الحلقة المفتوحة فقط)
// =====================================================
async function resetMonth() {
  if (!activeGroupId) { message("افتح حلقة أولاً.", "error"); return; }
  if (!["manager", "teacher"].includes(currentProfile.role)) {
    message("لا تملك صلاحية التصفير.", "error"); return;
  }

  const month = $("attendanceExportMonth").value || ($("attendanceDate").value || todayISO()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) { message("اختر شهرًا صحيحًا.", "error"); return; }

  const group = cachedGroups.find(g => g.id === activeGroupId);
  if (currentProfile.role === "teacher" && group?.teacher_id !== currentProfile.id) {
    message("يمكنك تصفير حلقاتك فقط.", "error"); return;
  }

  const groupName = activeGroupName || "الحلقة";
  if (!await confirmDialog({
    title: "تصفير حضور الحلقة",
    text: `سيتم حذف كل سجلات الحضور لشهر ${month} في حلقة «${groupName}» فقط. لا يمكن التراجع.`,
    confirmText: "نعم، احذف الكل",
    danger: true
  })) return;

  const btn = $("resetMonthlyAttendanceBtn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "جارٍ الحذف...";

  try {
    const { data, error } = await db.rpc("reset_attendance_month_for_group", {
      p_month: month, p_group_id: activeGroupId
    });
    if (error) { message("تعذر التصفير: " + error.message, "error"); return; }
    message(`تم حذف ${data} سجل من حلقة «${groupName}» لشهر ${month}.`, "success");
    loadAttendance();
  } catch (err) {
    message("خطأ: " + (err?.message || "غير معروف"), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// =====================================================
// Delete group
// =====================================================
async function deleteGroup(id, name) {
  if (!["manager", "teacher"].includes(currentProfile.role)) {
    message("لا تملك صلاحية حذف الحلقات.", "error"); return;
  }
  const group = cachedGroups.find(g => g.id === id);
  if (!group) { message("الحلقة غير موجودة.", "error"); return; }
  if (currentProfile.role === "teacher" && group.teacher_id !== currentProfile.id) {
    message("يمكنك حذف حلقاتك فقط.", "error"); return;
  }
  if (!await confirmDialog({
    title: "حذف الحلقة",
    text: `سيتم حذف «${name}» فقط إذا كانت فارغة من الطلاب وسجلات الحضور. متابعة؟`,
    confirmText: "نعم، احذف", danger: true
  })) return;

  const { count: studentCount, error: scErr } = await db
    .from("students").select("id", { count: "exact", head: true }).eq("group_id", id);
  if (scErr) { message("تعذر التحقق: " + scErr.message, "error"); return; }
  if ((studentCount || 0) > 0) {
    message(`لا يمكن حذف الحلقة — تحتوي على ${studentCount} طالب.`, "error"); return;
  }

  const { count: attCount, error: acErr } = await db
    .from("attendance_records").select("id", { count: "exact", head: true }).eq("group_id", id);
  if (acErr && !/does not exist|schema cache/i.test(acErr.message || "")) {
    message("تعذر التحقق من سجلات الحضور: " + acErr.message, "error"); return;
  }
  if ((attCount || 0) > 0) {
    message("لا يمكن حذف الحلقة — تحتوي على سجلات حضور.", "error"); return;
  }

  const { data, error } = await db.from("groups").delete().eq("id", id).select("id");
  if (error) { message("تعذر الحذف: " + error.message, "error"); return; }
  if (!data?.length) { message("لم يتم الحذف — تحقق من صلاحياتك.", "error"); return; }
  message("تم حذف الحلقة بنجاح.", "success");
  loadGroups();
  loadOverview();
}

// =====================================================
// Teachers
// =====================================================
async function loadTeachers() {
  const tbody = $("teachersRows");
  if (currentProfile.role !== "manager") {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">للمدير فقط.</td></tr>';
    return;
  }
  const { data, error } = await db.from("profiles")
    .select("id, full_name, is_active, role, email")
    .eq("role", "teacher").order("full_name");
  if (error) { tbody.innerHTML = '<tr><td colspan="3" class="empty">تعذر التحميل.</td></tr>'; return; }

  const teachers = data || [];
  window.__teachersMap = Object.fromEntries(teachers.map(t => [t.id, t]));

  tbody.innerHTML = teachers.map(t => `
    <tr>
      <td>${escapeHtml(t.full_name || "—")}</td>
      <td>${escapeHtml(t.email || "—")}</td>
      <td>${t.is_active ? '<span class="tag">نشط</span>' : '<span class="group-pill unassigned">معطّل</span>'}</td>
    </tr>`).join("") || '<tr><td colspan="3" class="empty">لا يوجد معلمون.</td></tr>';
}

function setTeacherManageModal(open) {
  const m = $("teacherManageBackdrop");
  m.classList.toggle("hidden", !open);
  m.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
}

async function refreshManageTeachers() {
  const sel = $("manageTeacherSelect");
  sel.disabled = true;
  sel.innerHTML = '<option value="">جارٍ التحميل...</option>';

  const { data, error } = await db.from("profiles")
    .select("id, full_name, is_active, role")
    .eq("role", "teacher").order("full_name");

  if (error) { sel.innerHTML = '<option value="">تعذر التحميل</option>'; return; }

  const teachers = data || [];
  window.__teachersMap = Object.fromEntries(teachers.map(t => [t.id, t]));

  sel.innerHTML = '<option value="">اختر المعلم</option>' +
    teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.full_name || "معلم")} ${t.is_active ? "" : "(معطّل)"}</option>`).join("");
  if (!teachers.length) sel.innerHTML = '<option value="">لا يوجد معلمون</option>';
  sel.disabled = false;
  updateManageTeacherActions();
}

function openChangeTeacherPassword() {
  const id = $("manageTeacherSelect").value;
  const t = window.__teachersMap?.[id];
  if (!t) { message("اختر معلمًا أولاً.", "error"); return; }

  $("changeTeacherPasswordName").value = t.full_name || "معلم";
  $("newTeacherPasswordField").value = generatePassword();
  $("changeTeacherPasswordStatus").textContent = "";
  $("changeTeacherPasswordBackdrop").classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => $("newTeacherPasswordField").focus(), 50);
}

function updateManageTeacherActions() {
  const id = $("manageTeacherSelect").value;
  const t = window.__teachersMap?.[id];
  $("manageEditTeacher")?.classList.toggle("hidden", !t);
  $("manageChangeTeacherPassword")?.classList.toggle("hidden", !t);
  $("manageToggleTeacher")?.classList.toggle("hidden", !t);
  $("manageDeleteTeacher")?.classList.toggle("hidden", !t);
  $("manageTeacherStatus").textContent = t
    ? `المعلم المحدد: ${t.full_name || "بلا اسم"} — ${t.is_active ? "نشط" : "معطّل"}`
    : "اختر معلمًا من القائمة.";
}

async function toggleTeacher(id, active) {
  if (!await confirmDialog({
    title: active ? "تعطيل الحساب" : "تفعيل الحساب",
    text: "هل تريد المتابعة؟",
    confirmText: active ? "تعطيل" : "تفعيل",
    danger: active
  })) return;

  const { error } = await db.from("profiles").update({ is_active: !active }).eq("id", id);
  if (error) { message("تعذر التحديث: " + error.message, "error"); return; }
  message("تم التحديث.", "success");
  loadTeachers();
}

async function deleteTeacher(id, name) {
  if (currentProfile.role !== "manager") {
    message("حذف المعلمين متاح للمدير فقط.", "error"); return;
  }
  if (!await confirmDialog({
    title: "حذف حساب المعلم",
    text: `سيتم حذف حساب «${name}» نهائياً. لا يمكن التراجع.`,
    confirmText: "نعم، احذف", danger: true
  })) return;

  const { data, error } = await db.rpc("delete_teacher_account", { p_teacher_id: id });
  if (error) { message("تعذر الحذف: " + error.message, "error"); return; }
  if (data?.error) { message(data.error, "error"); return; }
  message("تم حذف حساب المعلم.", "success");
  loadTeachers();
  loadOverview();
}

async function createTeacher(e) {
  e.preventDefault();
  const btn = $("createTeacherBtn");
  const name = $("newTeacherName").value.trim();
  const email = $("newTeacherEmail").value.trim().toLowerCase();
  const password = $("newTeacherPassword").value;
  const status = $("addTeacherStatus");

  if (!name || !email || password.length < 8) {
    status.textContent = "أكمل البيانات (كلمة المرور 8+)."; return;
  }

  btn.disabled = true;
  btn.textContent = "جارٍ الإنشاء...";
  status.textContent = "";

  const { data, error } = await db.rpc("create_teacher_account", {
    p_full_name: name, p_email: email, p_password: password
  });

  btn.disabled = false;
  btn.textContent = "إنشاء الحساب";

  if (error) { status.textContent = "خطأ: " + error.message; return; }
  if (data?.error) { status.textContent = data.error; return; }

  $("addTeacherForm").reset();
  $("addTeacherBackdrop").classList.add("hidden");
  document.body.classList.remove("modal-open");
  message(`✅ تم إنشاء حساب ${name}. البريد: ${email} — كلمة المرور: ${password}`, "success");
  loadTeachers();
}

// =====================================================
// Attendance reports
// =====================================================
async function loadAttendanceReportOptions() {
  if (cachedGroups.length) { fillGroupSelects(); return; }
  await loadGroupsCache();
  fillGroupSelects();
}

async function runReport() {
  const tbody = $("attendanceReportRows");
  tbody.innerHTML = '<tr><td colspan="6" class="empty">جارٍ التحميل...</td></tr>';

  let q = db.from("attendance_records")
    .select("student_id, group_id, attendance_date, status, achievements, note")
    .order("attendance_date", { ascending: false }).limit(5000);

  const start = $("reportStartDate").value;
  const end = $("reportEndDate").value;
  const gid = $("reportGroupFilter").value;
  const st = $("reportStatusFilter").value;

  if (start) q = q.gte("attendance_date", start);
  if (end) q = q.lte("attendance_date", end);
  if (gid && gid !== "all") q = q.eq("group_id", gid);
  if (st) q = q.eq("status", st);

  const { data, error } = await q;
  if (error) { tbody.innerHTML = '<tr><td colspan="6" class="empty">تعذر التحميل.</td></tr>'; return; }

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">لا يوجد سجلات.</td></tr>';
    $("reportPresentCount").textContent = $("reportAbsentCount").textContent = $("reportExcusedCount").textContent = "0";
    $("attendanceReportRowsCount").textContent = "0 سجل";
    return;
  }

  const sids = [...new Set(data.map(r => r.student_id))];
  const gids = [...new Set(data.map(r => r.group_id))];
  const [studentsRes, groupsRes] = await Promise.all([
    sids.length ? db.from("students").select("id, full_name").in("id", sids) : { data: [] },
    gids.length ? db.from("groups").select("id, name").in("id", gids) : { data: [] }
  ]);
  const sMap = Object.fromEntries((studentsRes.data || []).map(s => [s.id, s.full_name]));
  const gMap = Object.fromEntries((groupsRes.data || []).map(g => [g.id, g.name]));

  const search = $("reportStudentSearch").value.trim().toLowerCase();
  const filtered = data.filter(r => !search || (sMap[r.student_id] || "").toLowerCase().includes(search));

  $("reportPresentCount").textContent = filtered.filter(r => r.status === "present").length;
  $("reportAbsentCount").textContent = filtered.filter(r => r.status === "absent").length;
  $("reportExcusedCount").textContent = filtered.filter(r => r.status === "excused").length;
  $("attendanceReportRowsCount").textContent = `${filtered.length} سجل`;

  const labels = { present: "حاضر", absent: "غائب", excused: "غياب بعذر" };
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${escapeHtml(formatDate(r.attendance_date))}</td>
      <td>${escapeHtml(sMap[r.student_id] || "—")}</td>
      <td>${escapeHtml(gMap[r.group_id] || "—")}</td>
      <td><span class="attendance-status ${r.status}">${labels[r.status] || r.status}</span></td>
      <td>${escapeHtml(r.achievements || "—")}</td>
      <td>${escapeHtml(r.note || "—")}</td>
    </tr>`).join("");
}

// =====================================================
// Statistics
// =====================================================
async function loadStatistics() {
  const tbody = $("statisticsRows");
  if (currentProfile.role !== "manager") {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">للمدير فقط.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="6" class="empty">جارٍ التحميل...</td></tr>';

  const [tRes, gRes, sRes] = await Promise.all([
    db.from("profiles").select("id, full_name").eq("role", "teacher").order("full_name"),
    db.from("groups").select("id, name, teacher_id"),
    db.from("students").select("full_name, group_id, gender, notes")
  ]);

  if (tRes.error || gRes.error || sRes.error) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">تعذر التحميل.</td></tr>'; return;
  }

  const teachers = tRes.data || [];
  const groups = gRes.data || [];
  const students = sRes.data || [];

  let total = 0, boys = 0, girls = 0;
  const rows = [];

  teachers.forEach(t => {
    const tGroups = groups.filter(g => g.teacher_id === t.id);
    if (!tGroups.length) { rows.push({ teacher: t.full_name, group: "—", students: [] }); return; }
    tGroups.forEach(g => {
      const gStudents = students.filter(s => s.group_id === g.id);
      rows.push({ teacher: t.full_name, group: g.name, students: gStudents });
    });
  });

  rows.forEach(r => {
    total += r.students.length;
    boys += r.students.filter(s => s.gender === "male").length;
    girls += r.students.filter(s => s.gender === "female").length;
  });

  $("statsStudentsCount").textContent = total;
  $("statsBoysCount").textContent = boys;
  $("statsGirlsCount").textContent = girls;

  tbody.innerHTML = rows.map(r => {
    const special = r.students.filter(s => (s.notes || "").trim())
      .map(s => `${escapeHtml(s.full_name || "طالب")}: ${escapeHtml(s.notes)}`).join("؛ ");
    return `<tr>
      <td>${escapeHtml(r.teacher || "—")}</td>
      <td>${escapeHtml(r.group || "—")}</td>
      <td>${r.students.length}</td>
      <td>${r.students.filter(s => s.gender === "male").length}</td>
      <td>${r.students.filter(s => s.gender === "female").length}</td>
      <td>${special || "—"}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">لا يوجد بيانات.</td></tr>';
}

// =====================================================
// Event bindings
// =====================================================
function bindEvents() {
  document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  $("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    window.location.replace("./index.html");
  });

  $("closeNotice")?.addEventListener("click", () => $("notice").classList.remove("show"));

  $("openAddStudentModal").addEventListener("click", async () => {
    fillGroupSelects();
    setAddStudentModal(true);
  });
  $("closeAddStudentModal").addEventListener("click", () => setAddStudentModal(false));
  $("cancelAddStudentModal").addEventListener("click", () => setAddStudentModal(false));
  $("addStudentForm").addEventListener("submit", addStudent);

  $("openManageStudentModal").addEventListener("click", async () => {
    fillGroupSelects();
    setStudentManageModal(true);
    await refreshManageStudents();
  });
  $("openDeleteStudentModal").addEventListener("click", async () => {
    fillGroupSelects();
    setStudentManageModal(true);
    await refreshManageStudents();
  });
  $("closeStudentManageModal").addEventListener("click", () => setStudentManageModal(false));
  $("cancelStudentManageModal").addEventListener("click", () => setStudentManageModal(false));
  $("manageStudentGroup").addEventListener("change", refreshManageStudents);
  $("manageStudentSelect").addEventListener("change", updateManageActions);
  $("manageDeleteStudent").addEventListener("click", deleteStudent);
  $("manageEditStudent").addEventListener("click", () => {
    const row = window.__manageStudentsMap?.[$("manageStudentSelect").value];
    if (!row) return;
    setStudentManageModal(false);
    openStudentEdit(row);
  });

  $("closeStudentModal").addEventListener("click", () => {
    $("studentEditBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("cancelStudentModal").addEventListener("click", () => {
    $("studentEditBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("studentEditForm").addEventListener("submit", saveStudentEdit);

  $("openTransferStudentModal").addEventListener("click", openTransferModal);
  $("closeTransferStudentModal").addEventListener("click", () => setTransferModal(false));
  $("cancelTransferStudentModal").addEventListener("click", () => setTransferModal(false));
  $("transferFromGroup").addEventListener("change", loadTransferStudents);
  $("transferStudentForm").addEventListener("submit", saveTransfer);

  $("studentGroupFilter").addEventListener("change", loadStudents);
  $("searchStudents").addEventListener("click", loadStudents);
  $("studentSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadStudents(); });

  $("openCreateGroupModal").addEventListener("click", async () => {
    if (currentProfile.role === "manager") {
      $("newGroupTeacherField").classList.remove("hidden");
      const sel = $("newGroupTeacher");
      sel.innerHTML = '<option value="">جارٍ التحميل...</option>';
      const { data } = await db.from("profiles").select("id, full_name")
        .eq("role", "teacher").eq("is_active", true).order("full_name");
      sel.innerHTML = '<option value="">اختر المعلم</option>' +
        (data || []).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.full_name || "معلم")}</option>`).join("");
    } else {
      $("newGroupTeacherField").classList.add("hidden");
    }
    $("createGroupBackdrop").classList.remove("hidden");
    document.body.classList.add("modal-open");
  });
  $("closeCreateGroupModal").addEventListener("click", () => {
    $("createGroupBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("cancelCreateGroupModal").addEventListener("click", () => {
    $("createGroupBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("createGroupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("newGroupName").value.trim();
    const type = $("newGroupType").value.trim();
    if (!name || !type) { message("الاسم والنوع مطلوبان.", "error"); return; }

    const teacherId = currentProfile.role === "manager"
      ? $("newGroupTeacher").value
      : currentProfile.id;
    if (!teacherId) { message("اختر المعلم.", "error"); return; }

    const btn = $("createGroupBtn");
    btn.disabled = true;
    btn.textContent = "جارٍ الإنشاء...";

    const { error } = await db.from("groups").insert({
      name, group_type: type, teacher_id: teacherId,
      logo_url: $("newGroupLogo").value.trim() || null
    });

    btn.disabled = false;
    btn.textContent = "إنشاء الحلقة";

    if (error) { message("تعذر الإنشاء: " + error.message, "error"); return; }
    $("createGroupForm").reset();
    $("createGroupBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
    message("تم إنشاء الحلقة.", "success");
    loadGroups();
  });

  $("groupsRows").addEventListener("click", async e => {
    const viewBtn = e.target.closest("[data-view-group]");
    if (!viewBtn) return;
    await openGroupDetail(viewBtn.dataset.viewGroup, viewBtn.dataset.groupName);
  });

  // فلتر المعلم في صفحة الحلقات (للمدير فقط)
  $("manageTeacherFilter")?.addEventListener("change", () => {
    loadGroups();
  });

  $("manageGroupSelect")?.addEventListener("change", updateManageGroupButtons);

  $("manageEditGroupBtn")?.addEventListener("click", async () => {
    const id = $("manageGroupSelect").value;
    if (!id) return;
    openEditGroupModal(id);
  });

  $("manageDeleteGroupBtn")?.addEventListener("click", async () => {
    const id = $("manageGroupSelect").value;
    const group = cachedGroups.find(g => g.id === id);
    if (!group) return;
    await deleteGroup(group.id, group.name || "حلقة");
  });

  $("closeEditGroupModal")?.addEventListener("click", () => {
    $("editGroupBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("cancelEditGroupModal")?.addEventListener("click", () => {
    $("editGroupBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("editGroupForm")?.addEventListener("submit", saveGroupEdit);

  $("backToGroups").addEventListener("click", () => {
    $("groupDetailView").classList.add("hidden");
    $("groupsListPanel").classList.remove("hidden");
    activeGroupId = null;
  });
  $("groupStudentSearch").addEventListener("input", () => {
    const q = $("groupStudentSearch").value.trim().toLowerCase();
    renderGroupStudents(activeGroupStudents.filter(s => (s.full_name || "").toLowerCase().includes(q)));
  });

  $("loadAttendanceBtn").addEventListener("click", loadAttendance);
  $("attendanceDate").addEventListener("change", loadAttendance);
  $("saveAttendanceBtn").addEventListener("click", saveAttendance);
  $("exportMonthlyAttendanceBtn").addEventListener("click", exportCSV);
  $("resetMonthlyAttendanceBtn").addEventListener("click", resetMonth);

  $("openManageTeacherModal")?.addEventListener("click", async () => {
    setTeacherManageModal(true);
    await refreshManageTeachers();
  });
  $("openDeleteTeacherModal")?.addEventListener("click", async () => {
    setTeacherManageModal(true);
    await refreshManageTeachers();
  });
  $("closeTeacherManageModal")?.addEventListener("click", () => setTeacherManageModal(false));
  $("cancelTeacherManageModal")?.addEventListener("click", () => setTeacherManageModal(false));
  $("manageTeacherSelect")?.addEventListener("change", updateManageTeacherActions);

  $("manageEditTeacher")?.addEventListener("click", () => {
    const id = $("manageTeacherSelect").value;
    const t = window.__teachersMap?.[id];
    if (!t) return;
    const newName = prompt("اسم المعلم الجديد:", t.full_name || "");
    if (newName === null) return;
    if (!newName.trim()) { message("الاسم مطلوب.", "error"); return; }
    db.from("profiles").update({ full_name: newName.trim() }).eq("id", id).select("id").then(({ data, error }) => {
      if (error) { message("تعذر التعديل: " + error.message, "error"); return; }
      if (!data?.length) { message("لم يتم التعديل — تحقق من الصلاحيات.", "error"); return; }
      message("تم تعديل اسم المعلم.", "success");
      loadTeachers();
      refreshManageTeachers();
    });
  });

  $("manageChangeTeacherPassword")?.addEventListener("click", openChangeTeacherPassword);

  $("closeChangeTeacherPasswordModal")?.addEventListener("click", () => {
    $("changeTeacherPasswordBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("cancelChangeTeacherPasswordModal")?.addEventListener("click", () => {
    $("changeTeacherPasswordBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });

  $("changeTeacherPasswordForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("manageTeacherSelect").value;
    const password = $("newTeacherPasswordField").value;
    const status = $("changeTeacherPasswordStatus");

    if (!id || !password || password.length < 8) {
      status.textContent = "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
      return;
    }

    const btn = $("saveChangeTeacherPasswordBtn");
    btn.disabled = true;
    btn.textContent = "جارٍ التحديث...";
    status.textContent = "";

    const { data, error } = await db.rpc("update_teacher_password", {
      p_teacher_id: id, p_new_password: password
    });

    btn.disabled = false;
    btn.textContent = "تحديث كلمة المرور";

    if (error) { status.textContent = "خطأ: " + error.message; return; }
    if (data?.error) { status.textContent = data.error; return; }

    const teacherName = $("changeTeacherPasswordName").value;
    $("changeTeacherPasswordBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
    message(`✅ تم تحديث كلمة مرور ${teacherName}. كلمة المرور الجديدة: ${password}`, "success");
  });

  $("manageToggleTeacher")?.addEventListener("click", async () => {
    const id = $("manageTeacherSelect").value;
    const t = window.__teachersMap?.[id];
    if (!t) return;
    await toggleTeacher(t.id, t.is_active);
    await refreshManageTeachers();
  });

  $("manageDeleteTeacher")?.addEventListener("click", async () => {
    const id = $("manageTeacherSelect").value;
    const t = window.__teachersMap?.[id];
    if (!t) return;
    await deleteTeacher(t.id, t.full_name || "المعلم");
  });

  $("openAddTeacherModal").addEventListener("click", () => {
    $("newTeacherPassword").value = generatePassword();
    $("addTeacherStatus").textContent = "";
    $("addTeacherBackdrop").classList.remove("hidden");
    document.body.classList.add("modal-open");
    setTimeout(() => $("newTeacherName").focus(), 50);
  });
  $("closeAddTeacherModal").addEventListener("click", () => {
    $("addTeacherBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("cancelAddTeacherModal").addEventListener("click", () => {
    $("addTeacherBackdrop").classList.add("hidden");
    document.body.classList.remove("modal-open");
  });
  $("addTeacherForm").addEventListener("submit", createTeacher);

  $("runAttendanceReport").addEventListener("click", runReport);
  $("resetAttendanceReport").addEventListener("click", () => {
    $("reportStartDate").value = "";
    $("reportEndDate").value = "";
    $("reportGroupFilter").value = "";
    $("reportStudentSearch").value = "";
    $("reportStatusFilter").value = "";
    $("attendanceReportRows").innerHTML = '<tr><td colspan="6" class="empty">اختر الفترة ثم اضغط «عرض التقرير».</td></tr>';
  });

  $("refreshStatsBtn").addEventListener("click", loadStatistics);

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    ["addStudentBackdrop", "studentManageBackdrop", "studentEditBackdrop",
     "transferStudentBackdrop", "createGroupBackdrop", "editGroupBackdrop",
     "addTeacherBackdrop", "teacherManageBackdrop", "changeTeacherPasswordBackdrop"].forEach(id => {
      const el = $(id);
      if (el && !el.classList.contains("hidden")) {
        el.classList.add("hidden");
        document.body.classList.remove("modal-open");
      }
    });
  });
}

// =====================================================
// Init
// =====================================================
(async function init() {
  try {
    const ok = await requireProfile();
    if (!ok) return;

    await loadGroupsCache();
    await loadTeachersForFilter();
    fillGroupSelects();

    bindEvents();

    $("attendanceExportMonth").value = todayISO().slice(0, 7);
    showView("overview");
  } catch (err) {
    console.error(err);
    message("تعذر تحميل اللوحة: " + (err?.message || "خطأ"), "error");
  }
})();
