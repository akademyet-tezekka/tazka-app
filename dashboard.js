// =====================================================
// إعدادات Supabase
// =====================================================
const SUPABASE_URL = "https://zncfwhytbcsacxyxyqls.supabase.co";
const SUPABASE_KEY = "ضع_المفتاح_الكامل_هنا";

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
  message._t = setTimeout(() => n.classList.remove("show"), 6000);
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

// =====================================================
// View switching
// =====================================================
function showView(name) {
  ["overview", "students", "groups", "teachers", "attendanceReports", "statistics"]
    .forEach(v => $("view-" + v)?.classList.toggle("hidden", v !== name) ||
                  $(v + "View")?.classList.toggle("hidden", v !== name));

  document.querySelectorAll("[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name));

  const titles = {
    overview: ["نظرة عامة", "ملخص سريع لأداء الأكاديمية"],
    students: ["الطلاب", "إدارة بيانات الطلاب"],
    groups: [currentProfile?.role === "teacher" ? "حلقاتي" : "الحلقات", "إدارة الحلقات"],
    teachers: ["المعلمون", "إدارة حسابات المعلمين"],
    attendanceReports: ["تقارير الحضور", "عرض سجلات الحضور والغياب"],
    statistics: ["الإحصائيات", "إحصائيات المعلمين والحلقات"],
  };
  const [t, s] = titles[name] || ["لوحة التحكم", ""];
  $("pageTitle").textContent = t;
  $("pageSub").textContent = s;

  // تحميل القسم عند فتحه
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

  // إخفاء أقسام غير متاحة للمعلم
  if (profile.role === "teacher") {
    $("navTeachers")?.classList.add("hidden");
    $("navStats")?.classList.add("hidden");
    const gNav = $("groupsNav");
    if (gNav) gNav.innerHTML = '<i class="fa-solid fa-layer-group"></i> حلقاتي';
  } else {
    $("resetMonthlyAttendanceBtn")?.classList.remove("hidden");
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
// Overview
// =====================================================
async function loadOverview() {
  if (currentProfile.role !== "manager") return;
  const [s, g, t] = await Promise.all([
    db.from("students").select("id", { count: "exact", head: true }),
    db.from("groups").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher")
  ]);
  if (!s.error) $("studentsCount").textContent = s.count ?? 0;
  if (!g.error) $("groupsCount").textContent = g.count ?? 0;
  if (!t.error) $("teachersCount").textContent = t.count ?? 0;
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
  loadStudents();
  loadOverview();
}

// =====================================================
// Manage students (edit/delete via modal)
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

  let q = db.from("students").select("id, full_name, group_id, created_by, gender, birth_date, residence, phone, notes")
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
  loadStudents();
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
  loadStudents();
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
  loadStudents();
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
  fillGroupSelects();
  $("visibleGroupsCount").textContent = `${cachedGroups.length} حلقة`;

  if (!cachedGroups.length) {
    container.innerHTML = '<div class="empty">لا توجد حلقات.</div>';
    return;
  }

  // أسماء المعلمين + عدد الطلاب
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

  container.innerHTML = cachedGroups.map(g => {
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

  // تحميل الحضور
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
  const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';

  const rows = [["التاريخ", "الطالب", "الحالة", "الإنجازات", "ملاحظات"].map(esc).join(";")];
  data.forEach(r => {
    rows.push([r.attendance_date, names.get(r.student_id) || "—", labels[r.status] || r.status,
      r.achievements || "", r.note || ""].map(esc).join(";"));
  });

  const csv = "\uFEFF" + rows.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `حضور-${activeGroupName}-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  message("تم التصدير.", "success");
}

async function resetMonth() {
  if (currentProfile.role !== "manager") { message("للمدير فقط.", "error"); return; }
  const month = $("attendanceExportMonth").value || ($("attendanceDate").value || todayISO()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) { message("اختر شهرًا.", "error"); return; }

  if (!await confirmDialog({
    title: "تصفير الحضور",
    text: `سيتم حذف كل سجلات الحضور لشهر ${month}. لا يمكن التراجع.`,
    confirmText: "نعم، احذف الكل",
    danger: true
  })) return;

  const { data, error } = await db.rpc("reset_attendance_month", { p_month: month });
  if (error) { message("تعذر التصفير: " + error.message, "error"); return; }
  message(`تم حذف ${data} سجل.`, "success");
  loadAttendance();
}

// =====================================================
// Teachers
// =====================================================
async function loadTeachers() {
  const tbody
