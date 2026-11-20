(() => {
  const cfg = window.NTS_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  const $ = id => document.getElementById(id);
  const state = { client:null, user:null, role:null, editingPassportId: null };
  const statusName = s => ({MAINTENANCE:"MAINTENANCE — обслуживание",VERIFIED:"NTS ENGINE VERIFIED",REBUILT:"NTS ENGINE REBUILT"}[s] || s || "—");
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const msg = (el, text, bad=false) => { el.textContent=text; el.style.color=bad?"var(--danger)":"var(--muted)"; };
  
  if (configured && window.supabase) {
    state.client = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  } else {
    $("publicResult").textContent="Демо-режим не подключён: сначала настройте Supabase по README. После подключения публичный поиск будет работать для всех.";
    $("loginBox").insertAdjacentHTML("beforeend",'<p class="hint">Система пока не подключена к общей базе данных.</p>');
  }

  async function publicLookup() {
    const n=$("publicNumber").value.trim();
    if(!n) return;
    if(!state.client){$("publicResult").textContent="База данных ещё не подключена.";return;}
    const {data,error}=await state.client.rpc("public_engine_passport",{p_engine_number:n});
    if(error || !data || !data.passport){$("publicResult").textContent="Паспорт не найден или временно недоступен.";return;}
    renderPassport($("publicResult"),data,false);
  }

  function renderPassport(target,data,staff) {
    const p=data.passport || data, history=data.history || [], photos=data.photos || [];
    
    // Форматируем даты для отображения
    const intakeDate = p.intake_date ? new Date(p.intake_date).toLocaleDateString("ru-RU") : "—";
    const issueDate = p.issue_date ? new Date(p.issue_date).toLocaleDateString("ru-RU") : "—";
    const isIssuedText = p.is_issued ? "Выдан клиенту" : "В работе / Не выдан";
    const issuedColor = p.is_issued ? "var(--accent)" : "var(--muted)";

    target.innerHTML=`<div class="passport"><div class="section-head"><div><div class="eyebrow">NTS ENGINE PASSPORT</div><h3>${esc(p.engine_number)}</h3></div><span class="status">${esc(statusName(p.status))}</span></div>
      <div class="passport-grid">${[
        ["Модель двигателя",p.engine_model],["Техника",`${p.vehicle_brand||""} ${p.vehicle_model||""}`.trim()],["Тип",p.engine_type],["Год",p.year],["Серийный номер",p.serial_number],["Номер заказа",p.order_number],["Дата приёма",intakeDate],["Дата выдачи",issueDate]
      ].map(([k,v])=>`<div class="kv"><small>${esc(k)}</small>${esc(v||"—")}</div>`).join("")}</div>
      
      <div class="kv" style="margin-top:10px; border-color:${issuedColor}"><small>Статус выдачи</small><b style="color:${issuedColor}">${isIssuedText}</b></div>

      ${p.description?`<h4>Описание</h4><p>${esc(p.description)}</p>`:""}
      ${p.public_summary?`<h4>Работы и результаты</h4><p>${esc(p.public_summary)}</p>`:""}
      <h4>История обслуживания</h4>${history.length?history.map(h=>`<div class="history-item"><b>${esc(h.title)}</b><div>${esc(h.description||"")}</div><small>${esc(h.work_date||"")} · ${esc(h.order_number||"")}</small></div>`).join(""):"<p class='muted'>Записей пока нет.</p>"}
      ${photos.length?`<h4>Фотографии</h4><div class="photo-grid">${photos.map(ph=>`<a href="${esc(ph.url)}" target="_blank" rel="noopener"><img src="${esc(ph.url)}" alt="Фото двигателя"></a>`).join("")}</div>`:""}
      
      ${staff?`<div class="toolbar" style="flex-wrap:wrap; gap:10px;">
        <button class="secondary" onclick="window.NTS.editPassport('${esc(p.id)}')">Редактировать</button>
        <button class="secondary" onclick="window.NTS.toggleIssued('${esc(p.id)}', ${!p.is_issued})" style="background:${issuedColor}; color:#101317;">${p.is_issued ? 'Отметить: Не выдан' : 'Отметить: Выдан'}</button>
        <button class="secondary" onclick="window.NTS.downloadPdf('${esc(p.id)}')">Скачать PDF</button>
        <button class="secondary" onclick="window.NTS.addHistory('${esc(p.id)}')">Добавить запись</button>
        <button class="secondary" onclick="window.NTS.changeStatus('${esc(p.id)}')">Изменить статус</button>
        ${state.role === 'admin' ? `<button class="secondary" style="background:var(--danger); color:#101317; margin-left:auto;" onclick="window.NTS.deletePassport('${esc(p.id)}')">Удалить</button>` : ''}
      </div>`:`<button class="secondary" onclick="window.NTS.publicPdf('${esc(p.engine_number)}')">Скачать публичный PDF</button>`}
      </div>`;
  }

  async function getPassport(id) {
    const {data,error}=await state.client.rpc("staff_engine_passport",{p_engine_id:id});
    if(error) throw error; return data;
  }

  async function loadRecords(q="") {
    const query=state.client.from("engine_passports").select("id,engine_number,engine_model,status,order_number,updated_at,is_issued").order("updated_at",{ascending:false}).limit(100);
    const {data,error}=q?await query.or(`engine_number.ilike.%${q}%,engine_model.ilike.%${q}%,order_number.ilike.%${q}%`):await query;
    if(error){$("recordsList").textContent=error.message;return;}
    $("recordsList").innerHTML=(data||[]).map(r=>`<div class="record"><div><h3>${esc(r.engine_number)}</h3><small>${esc(r.engine_model)} · ${esc(statusName(r.status))} · ${esc(r.order_number||"без заказа")} ${r.is_issued ? '· <b style="color:var(--accent)">Выдан</b>' : ''}</small></div><button onclick="window.NTS.openRecord('${esc(r.id)}')">Открыть</button></div>`).join("")||"<p class='muted'>Паспортов пока нет.</p>";
  }

  async function openRecord(id) { 
    try {
      const d=await getPassport(id); 
      renderPassport($("recordsList"),d,true);
    } catch(e) {
      alert(e.message);
    }
  }

  async function uploadPhotos(files,passportId) {
    const rows=[];
    for(const f of files){
      if(!f.type.startsWith("image/")) continue;
      if(f.size>12*1024*1024) throw new Error("Фото больше 12 МБ: "+f.name);
      const path=`${passportId}/${Date.now()}-${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const {error}=await state.client.storage.from(cfg.STORAGE_BUCKET).upload(path,f,{upsert:false,contentType:f.type});
      if(error) throw error;
      rows.push({passport_id:passportId,storage_path:path,caption:f.name,is_public:true});
    }
    if(rows.length){const {error}=await state.client.from("engine_photos").insert(rows);if(error)throw error;}
  }

  async function login(){
    const {data,error}=await state.client.auth.signInWithPassword({email:$("email").value,password:$("password").value});
    if(error){alert(error.message);return;}
    state.user=data.user;
    const {data:profile,error:e}=await state.client.from("staff_roles").select("role,display_name").eq("user_id",state.user.id).single();
    if(e||!profile){await state.client.auth.signOut();alert("Для аккаунта не назначена роль. Обратитесь к администратору.");return;}
    state.role=profile.role;
    $("loginBox").hidden=true;$("workspace").hidden=false;$("sessionTag").textContent="Авторизован";
    $("userEmail").textContent=profile.display_name||state.user.email;$("userRole").textContent=state.role;
    $("teamTab").hidden=state.role!=="admin";
    await loadRecords();
  }

  async function editPassport(id) {
    try {
      const d = await getPassport(id);
      const p = d.passport;
      
      state.editingPassportId = id; 
      document.querySelector('.tab[data-tab="new"]').click();

      const form = $("passportForm");
      form.elements.engine_number.value = p.engine_number || '';
      form.elements.engine_model.value = p.engine_model || '';
      form.elements.vehicle_brand.value = p.vehicle_brand || '';
      form.elements.vehicle_model.value = p.vehicle_model || '';
      form.elements.year.value = p.year || '';
      form.elements.engine_type.value = p.engine_type || '4Т одноцилиндровый';
      form.elements.serial_number.value = p.serial_number || '';
      form.elements.order_number.value = p.order_number || '';
      form.elements.description.value = p.description || '';
      form.elements.public_summary.value = p.public_summary || '';
      form.elements.intake_date.value = p.intake_date || '';
      form.elements.issue_date.value = p.issue_date || '';
      form.elements.is_issued.value = String(p.is_issued);

      if (state.role === 'mechanic') {
        form.elements.status.value = p.status;
        form.elements.status.disabled = true;
      } else {
        form.elements.status.value = p.status || 'MAINTENANCE';
        form.elements.status.disabled = false;
      }

      form.querySelector('button[type="submit"]').textContent = "Сохранить изменения";
      $("newTab").scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
      alert("Ошибка загрузки данных: " + e.message);
    }
  }

  async function createPassport(ev){
    ev.preventDefault();
    const f=ev.currentTarget;
    const v=Object.fromEntries(new FormData(f).entries());
    const photoFiles=[...f.elements.photos.files];
    delete v.photos;
    
    v.year = v.year ? Number(v.year) : null;
    v.intake_date = v.intake_date ? v.intake_date : null;
    v.issue_date = v.issue_date ? v.issue_date : null;
    v.is_issued = v.is_issued === "true"; // Преобразуем строку в boolean

    if (state.editingPassportId) {
      delete v.engine_number; 
      
      const { error } = await state.client
        .from("engine_passports")
        .update(v)
        .eq("id", state.editingPassportId);

      if (error) {
        msg($("formMessage"), error.message, true);
        return;
      }

      if (photoFiles.length > 0) {
        try {
          await uploadPhotos(photoFiles, state.editingPassportId);
        } catch (e) {
          console.error("Не удалось загрузить фото:", e);
        }
      }

      msg($("formMessage"), "Паспорт успешно обновлён!");
      
      state.editingPassportId = null;
      f.reset();
      f.elements.status.disabled = false;
      f.querySelector('button[type="submit"]').textContent = "Создать паспорт";
      
      await loadRecords();
      
    } else {
      const {data,error}=await state.client.from("engine_passports").insert(v).select("id").single();
      if(error){
        msg($("formMessage"),error.message,true);
        return;
      }
      try{
        await uploadPhotos(photoFiles,data.id);
        msg($("formMessage"),"Паспорт создан.");
        f.reset();
        await loadRecords();
      } catch(e){
        msg($("formMessage"),"Паспорт создан, но фото загрузить не удалось: "+e.message,true);
      }
    }
  }

  async function deletePassport(id) {
    if (state.role !== 'admin') return alert("Только администратор может удалять паспорта.");
    if (!confirm("Вы уверены, что хотите БЕЗВОЗВРАТНО удалить этот паспорт и всю его историю?")) return;
    
    const { error } = await state.client.from("engine_passports").delete().eq("id", id);
    if (error) {
      alert("Ошибка удаления: " + error.message);
    } else {
      alert("Паспорт удален.");
      $("recordsList").innerHTML = "<p class='muted'>Паспорт удален. Выберите другой из списка.</p>";
      await loadRecords();
    }
  }

  async function toggleIssued(id, newStatus) {
    const { error } = await state.client.from("engine_passports").update({ is_issued: newStatus }).eq("id", id);
    if (error) alert(error.message);
    else openRecord(id);
  }

  async function addHistory(id){
    const title=prompt("Название записи (например, Дефектовка ГБЦ):");if(!title)return;
    const description=prompt("Описание работ и результатов:")||"";
    const date=prompt("Дата YYYY-MM-DD:",new Date().toISOString().slice(0,10));
    const {error}=await state.client.from("engine_history").insert({passport_id:id,title,description,work_date:date,created_by:state.user.id});
    if(error)alert(error.message);else openRecord(id);
  }

  async function changeStatus(id){
    if(!["quality","admin"].includes(state.role)){alert("Изменять статус может только quality или admin.");return;}
    const status=prompt("Введите MAINTENANCE, VERIFIED или REBUILT:");
    if(!["MAINTENANCE","VERIFIED","REBUILT"].includes(status||""))return;
    const {error}=await state.client.from("engine_passports").update({status,quality_approved_by:state.user.id,quality_approved_at:new Date().toISOString()}).eq("id",id);
    if(error)alert(error.message);else openRecord(id);
  }

  async function pdfForData(d, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;

    try {
      const fontUrlRegular = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
      const fontUrlBold = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf';
      
      const loadFont = async (url) => {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      const regularBase64 = await loadFont(fontUrlRegular);
      const boldBase64 = await loadFont(fontUrlBold);

      doc.addFileToVFS('Roboto-Regular.ttf', regularBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFileToVFS('Roboto-Medium.ttf', boldBase64);
      doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold');
      doc.setFont('Roboto', 'normal');
    } catch (e) { console.warn(e); }

    const p = d.passport || d;
    const history = d.history || [];

    const checkPage = (needSpace) => {
      if (y + needSpace > 280) { doc.addPage(); y = 20; }
    };
    
    const addText = (text, size = 10, isBold = false, color = [0, 0, 0]) => {
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont('Roboto', isBold ? 'bold' : 'normal'); 
      const lines = doc.splitTextToSize(String(text || "—"), 180);
      checkPage(lines.length * 5);
      doc.text(lines, 15, y);
      y += lines.length * 5 + 2;
    };

    const drawLine = () => {
      doc.setDrawColor(200, 200, 200);
      doc.line(15, y, 195, y);
      y += 5;
    };

    const drawKV = (key, value) => {
      checkPage(6);
      doc.setFont('Roboto', 'normal'); 
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(key + ":", 15, y);
      doc.setTextColor(0, 0, 0);
      doc.text(String(value || "—"), 60, y);
      y += 6;
    };

    const drawTable = (data) => {
      const colWidths = [45, 30, 20, 20, 20, 30];
      const startX = 15;
      const rowHeight = 8;
      checkPage(data.length * rowHeight + 15);

      doc.setFillColor(240, 240, 240);
      doc.rect(startX, y, 180, rowHeight, 'F');
      doc.setDrawColor(0, 0, 0);
      doc.setFont('Roboto', 'normal'); 
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      
      let x = startX;
      data[0].forEach((header, i) => {
        doc.text(header, x + 2, y + 5);
        doc.rect(x, y, colWidths[i], rowHeight);
        x += colWidths[i];
      });
      y += rowHeight;

      doc.setFontSize(8);
      for (let i = 1; i < data.length; i++) {
        x = startX;
        data[i].forEach((cell, j) => {
          doc.rect(x, y, colWidths[j], rowHeight);
          doc.text(String(cell || ""), x + 2, y + 5);
          x += colWidths[j];
        });
        y += rowHeight;
      }
      y += 5;
    };

    doc.setFont('Roboto', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text("NTS SERVICE · ENGINE PASSPORT", 15, y);
    y += 8;
    
    addText("Карточка двигателя", 18, true);
    y += 4;
    drawLine();

    const intakeDate = p.intake_date ? new Date(p.intake_date).toLocaleDateString("ru-RU") : "—";
    const issueDate = p.issue_date ? new Date(p.issue_date).toLocaleDateString("ru-RU") : "—";
    const isIssuedText = p.is_issued ? "Выдан клиенту" : "В работе / Не выдан";

    drawKV("Номер двигателя", p.engine_number);
    drawKV("Номер заказа", p.order_number);
    drawKV("Статус ремонта", statusName(p.status));
    drawKV("Статус выдачи", isIssuedText);
    drawKV("Модель, номер на картере", `${p.engine_model} / ${p.serial_number || '—'}`);
    drawKV("Техника (марка, год)", `${p.vehicle_brand || ''} ${p.vehicle_model || ''} (${p.year || '—'})`);
    drawKV("Дата приёма", intakeDate);
    drawKV("Дата выдачи", issueDate);
    drawKV("Клиент, контакт", "Данные скрыты или не заполнены");
    
    y += 5;
    addText("Жалоба клиента / Описание:", 10, true);
    addText(p.description || "Не указана", 10);
    
    addText("Выполненные работы (кратко):", 10, true);
    addText(p.public_summary || "Не указаны", 10);
    
    y += 5;
    drawLine();

    addText("Дефектовочный акт", 14, true);
    y += 2;
    addText("Вердикты: OK · допустимый износ · замена · мехобработка · не проверялось.", 9, false, [100,100,100]);
    y += 3;

    const defectRows = [
      ["Узел / параметр", "Инструмент", "Номинал", "Допуск", "Факт", "Вердикт"],
      ["Цилиндр: диаметр, овал.", "нутромер", "", "", "", ""],
      ["Поршень: диаметр юбки", "микрометр", "", "", "", ""],
      ["Зазор поршень-цилиндр", "расчёт", "", "", "", ""],
      ["Кольца: зазор в замке", "щупы", "", "", "", ""],
      ["ГБЦ: плоскостность", "линейка, щупы", "", "", "", ""],
      ["Клапаны и направляющие", "микрометр", "", "", "", ""],
      ["Сёдла и фаски", "осмотр", "", "", "", ""],
      ["Распредвал: кулачки", "микрометр", "", "", "", ""],
      ["Цепь ГРМ, натяжитель", "осмотр", "", "", "", ""],
      ["Коленвал: биение", "индикатор", "", "", "", ""],
      ["Шатун: зазоры", "индикатор, щупы", "", "", "", ""],
      ["Сцепление и КПП", "осмотр", "", "", "", ""]
    ];
    
    drawTable(defectRows);

    addText("Итог акта:", 10, true);
    addText("Причина неисправности: _________________________________________________", 10);
    addText("Стоимость (работа/детали): ____________________________________________", 10);
    addText("Срок: ______________   Согласие клиента: _______________________", 10);
    
    y += 5;
    drawLine();

    addText("История обслуживания", 14, true);
    y += 2;
    if (history.length > 0) {
      history.forEach(h => {
        checkPage(15);
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(10);
        doc.text(`${h.work_date || ""} | ${h.title || ""}`, 15, y);
        y += 5;
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        const descLines = doc.splitTextToSize(h.description || "", 175);
        doc.text(descLines, 20, y);
        y += descLines.length * 4 + 4;
      });
    } else {
      addText("Записей о работах пока нет.", 10, false, [100,100,100]);
    }

    y += 5;
    drawLine();

    addText("Контроль качества и гарантия", 14, true);
    y += 2;
    drawKV("КК пройден (дата)", p.quality_approved_at ? new Date(p.quality_approved_at).toLocaleDateString("ru-RU") : "Не пройден");
    drawKV("Гарантия до", "Укажите вручную"); 
    
    checkPage(30);
    y = 270;
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Документ сформирован цифровой системой NTS ENGINE PASSPORT.", 15, y);
    doc.text("Статус — внутренний результат процесса NTS, не государственная сертификация.", 15, y + 4);
    doc.text("Фотографии доступны в цифровом паспорте на сайте.", 15, y + 8);

    doc.save(filename);
  }

  window.NTS={
    openRecord,
    addHistory,
    changeStatus,
    editPassport,
    deletePassport,
    toggleIssued,
    async downloadPdf(id){try{await pdfForData(await getPassport(id),"NTS-"+id+".pdf");}catch(e){alert(e.message);}},
    async publicPdf(n){const {data,error}=await state.client.rpc("public_engine_passport",{p_engine_number:n});if(error||!data?.passport){alert("Паспорт не найден");return;}pdfForData(data,n+".pdf");}
  };

  $("searchBtn").onclick=publicLookup;
  $("publicNumber").addEventListener("keydown",e=>{if(e.key==="Enter")publicLookup();});
  $("loginBtn").onclick=()=>state.client?login():alert("Сначала подключите Supabase.");
  $("logoutBtn").onclick=async()=>{await state.client.auth.signOut();location.reload();};
  $("passportForm").onsubmit=createPassport;
  $("staffSearchBtn").onclick=()=>loadRecords($("staffSearch").value.trim());
  
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
    $("recordsTab").hidden=b.dataset.tab!=="records";
    $("newTab").hidden=b.dataset.tab!=="new";
    $("teamTabContent").hidden=b.dataset.tab!=="team";

    if (b.dataset.tab === 'new' && !state.editingPassportId) {
      const form = $("passportForm");
      form.reset();
      form.elements.status.disabled = false;
      form.querySelector('button[type="submit"]').textContent = "Создать паспорт";
      msg($("formMessage"), ""); 
    }
    if (b.dataset.tab !== 'new') {
      state.editingPassportId = null;
    }
  });

  $("assignRoleBtn").onclick=async()=>{
    if(state.role!=="admin")return;
    const {error}=await state.client.from("staff_roles").upsert({user_id:$("staffId").value.trim(),role:$("staffRole").value});
    msg($("teamMessage"),error?error.message:"Роль назначена.",!!error);
  };
})();