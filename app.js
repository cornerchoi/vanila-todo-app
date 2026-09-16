/**
 * @file app.js
 * @description 순수 Vanilla JS 기반 로컬 할 일 관리(Todo) 애플리케이션 — 최종 완성본
 */

'use strict';

// ==========================================================================
// 1. 상수 및 초기 상태
// ==========================================================================

const STORAGE_KEY = 'todos_data';

/**
 * @typedef {'personal' | 'work'} TodoCategory
 *
 * @typedef {Object} TodoItem
 * @property {string}       id          - 'todo_' + timestamp 형식 고유 ID
 * @property {string}       text        - 할 일 본문 (최대 100자)
 * @property {TodoCategory} category    - 'personal' | 'work'
 * @property {boolean}      isCompleted - 완료 여부
 * @property {string}       createdAt   - ISO 8601 생성 일시
 */

/** 전체 애플리케이션 상태 */
const state = {
  /** @type {TodoItem[]} */
  todos: [],
  /** @type {'all' | 'personal' | 'work'} */
  filter: 'all',
  /** @type {string | null} 인라인 수정 중인 Todo ID */
  editingId: null,
  /** @type {boolean} LocalStorage 사용 가능 여부 */
  storageAvailable: true
};

/**
 * 키워드 기반 자동 카테고리 분류 사전
 */
const CATEGORY_KEYWORDS = {
  work: [
    '회의', '미팅', '보고서', '보고', '업무', '프로젝트', '기획', '개발', '배포', '출장',
    '마감', '발표', '이슈', '버그', '메일', '이메일', '결재', '리뷰', '코드', '서류',
    '고객', '클라이언트', '납기', '스프린트', 'sprint', 'jira', 'slack', 'meeting', 'work',
    'project', 'client', 'report', 'code', 'deploy', 'presentation', 'pr', 'qa', '테스트',
    '피드백', '협업', '파트너', '세미나', '컨퍼런스'
  ],
  personal: [
    '장보기', '쇼핑', '마트', '운동', '헬스', '병원', '진료', '약국', '약', '청소',
    '빨래', '식사', '요리', '독서', '책', '취미', '영화', '약속', '여행', '친구',
    '가족', '부모님', '생일', '선물', '은행', '적금', '보험', '산책', '휴식', 'personal',
    'shopping', 'workout', 'study', 'health', 'cafe', '카페', '커피', '취침', '세탁',
    '공부', '과제', '숙제', '반려견', '반려묘', '치과', '안과'
  ]
};

/**
 * 텍스트 내용을 분석하여 적절한 카테고리를 추론합니다.
 * @param {string} text - 분석할 할 일 텍스트
 * @returns {'work' | 'personal' | null} 감지된 카테고리 또는 null
 */
function detectCategory(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();

  let workScore = 0;
  let personalScore = 0;

  CATEGORY_KEYWORDS.work.forEach(kw => {
    if (lower.includes(kw.toLowerCase())) {
      workScore += kw.length;
    }
  });

  CATEGORY_KEYWORDS.personal.forEach(kw => {
    if (lower.includes(kw.toLowerCase())) {
      personalScore += kw.length;
    }
  });

  if (workScore > personalScore && workScore > 0) return 'work';
  if (personalScore > workScore && personalScore > 0) return 'personal';
  return null;
}

// ==========================================================================
// 2. 보안 — XSS 방지 헬퍼
// ==========================================================================

/**
 * HTML 특수 문자를 엔티티로 인코딩합니다.
 * innerHTML 삽입 전 반드시 통과시켜야 합니다.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// 3. LocalStorage 연동
// ==========================================================================

/**
 * LocalStorage 사용 가능 여부를 탐지합니다.
 * 시크릿 모드 또는 용량 초과 상황을 포함한 예외를 처리합니다.
 * @returns {boolean}
 */
function detectStorageAvailability() {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * LocalStorage에서 Todo 목록을 안전하게 로드합니다.
 * 데이터가 없거나 손상·필드 누락 시 빈 배열을 반환합니다.
 * @returns {TodoItem[]}
 */
function loadTodos() {
  if (!state.storageAvailable) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[TodoApp] localStorage 데이터가 배열이 아닙니다. 초기화합니다.');
      return [];
    }

    return parsed.filter(item =>
      item &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      ['personal', 'work'].includes(item.category) &&
      typeof item.isCompleted === 'boolean' &&
      typeof item.createdAt === 'string'
    );
  } catch (err) {
    console.error('[TodoApp] loadTodos 실패 (JSON 손상):', err);
    return [];
  }
}

/**
 * 현재 state.todos를 LocalStorage에 저장합니다.
 * 시크릿 모드·용량 초과·권한 오류 등 모든 예외를 포착합니다.
 */
function saveTodos() {
  if (!state.storageAvailable) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
  } catch (err) {
    console.error('[TodoApp] saveTodos 실패:', err);
    // 저장 실패 시 경고 배너 노출
    showStorageErrorBanner();
  }
}

// ==========================================================================
// 4. 날짜 포맷 헬퍼
// ==========================================================================

/**
 * ISO 날짜 문자열을 'M/D HH:mm' 형식으로 변환합니다.
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// ==========================================================================
// 5. DOM 참조
// ==========================================================================

const todoListEl            = document.getElementById('todo-list');
const emptyStateEl          = document.getElementById('empty-state');
const todoFormEl            = document.getElementById('todo-form');
const todoInputEl           = document.getElementById('todo-input');
const todoCategoryEl        = document.getElementById('todo-category');
const inputErrorEl          = document.getElementById('input-error');
const categorySuggestHintEl = document.getElementById('category-suggest-hint');
const filterButtons         = document.querySelectorAll('.filter-btn');
const clearCompletedBtn     = document.getElementById('clear-completed-btn');
const todoBadgeEl           = document.getElementById('todo-count');
const footerSummaryEl       = document.getElementById('footer-summary');
const progressPercentEl     = document.getElementById('progress-percent');
const progressFillEl        = document.getElementById('progress-bar-fill');
const progressTrackEl       = progressFillEl ? progressFillEl.parentElement : null;

// ==========================================================================
// 6. 에러 및 카테고리 힌트 UI 헬퍼
// ==========================================================================

/**
 * 입력창 에러 메시지를 표시합니다.
 * @param {string} message
 */
function showError(message) {
  if (!inputErrorEl || !todoInputEl) return;
  inputErrorEl.textContent = message;
  inputErrorEl.classList.remove('hidden');
  todoInputEl.classList.add('invalid');
  todoInputEl.setAttribute('aria-invalid', 'true');
  todoInputEl.focus();
}

/**
 * 입력창 에러 상태를 초기화합니다.
 */
function clearError() {
  if (!inputErrorEl || !todoInputEl) return;
  inputErrorEl.textContent = '';
  inputErrorEl.classList.add('hidden');
  todoInputEl.classList.remove('invalid');
  todoInputEl.removeAttribute('aria-invalid');
}

/**
 * 입력 텍스트의 키워드를 분석하여 카테고리를 자동 분류하고 시각적 피드백을 제공합니다.
 * @param {string} text - 현재 입력 중인 텍스트
 */
function handleCategoryAutoDetection(text) {
  if (!todoCategoryEl) return;

  const detected = detectCategory(text);

  if (detected) {
    todoCategoryEl.value = detected;
    todoCategoryEl.classList.add('auto-highlight');

    if (categorySuggestHintEl) {
      const categoryName = detected === 'work' ? '업무' : '개인';
      categorySuggestHintEl.textContent = `✨ 키워드를 감지하여 '${categoryName}' 카테고리로 자동 지정되었습니다.`;
      categorySuggestHintEl.classList.remove('hidden');
    }
  } else {
    todoCategoryEl.classList.remove('auto-highlight');
    if (categorySuggestHintEl) {
      categorySuggestHintEl.classList.add('hidden');
      categorySuggestHintEl.textContent = '';
    }
  }
}

/**
 * LocalStorage 저장 실패 시 경고 배너를 노출합니다.
 */
function showStorageErrorBanner() {
  let banner = document.querySelector('.storage-error-banner');
  if (!banner) {
    banner = document.createElement('p');
    banner.className = 'storage-error-banner';
    banner.innerHTML = '⚠️ 저장 공간에 접근할 수 없어 데이터가 유지되지 않을 수 있습니다.';
    const main = document.querySelector('.app-main');
    if (main) main.prepend(banner);
  }
  banner.classList.remove('hidden');
}

// ==========================================================================
// 7. 필터링
// ==========================================================================

/**
 * 현재 state.filter에 따라 Todo 배열을 필터링합니다.
 * @returns {TodoItem[]}
 */
function getFilteredTodos() {
  switch (state.filter) {
    case 'personal': return state.todos.filter(t => t.category === 'personal');
    case 'work':     return state.todos.filter(t => t.category === 'work');
    default:         return state.todos;
  }
}

// ==========================================================================
// 8. DOM 생성 — Todo 아이템 (뷰 모드 / 수정 모드 분기)
// ==========================================================================

/**
 * Todo 데이터로 li 요소를 생성합니다.
 * 이벤트는 상위 컨테이너의 이벤트 위임으로 처리됩니다.
 * @param {TodoItem} todo
 * @returns {HTMLLIElement}
 */
function createTodoElement(todo) {
  const li = document.createElement('li');
  li.dataset.id = todo.id;

  const isEditing = state.editingId === todo.id;

  // 카테고리 뱃지 (공통)
  const badge = document.createElement('span');
  badge.className = `todo-category-badge ${todo.category}`;
  badge.textContent = todo.category === 'personal' ? '개인' : '업무';

  if (isEditing) {
    // ---- 수정 모드 ----
    li.className = 'todo-item editing';

    const wrapper = document.createElement('div');
    wrapper.className = 'edit-input-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-todo-input';
    input.value = todo.text;
    input.maxLength = 100;
    input.setAttribute('aria-label', '할 일 내용 수정');

    const hint = document.createElement('span');
    hint.className = 'edit-hint';
    hint.textContent = 'Enter: 저장 · Esc: 취소';

    wrapper.appendChild(input);
    wrapper.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'action-btn save-btn';
    saveBtn.textContent = '저장';
    saveBtn.title = '저장 (Enter)';
    saveBtn.setAttribute('aria-label', '수정 저장');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'action-btn cancel-btn';
    cancelBtn.textContent = '취소';
    cancelBtn.title = '취소 (Esc)';
    cancelBtn.setAttribute('aria-label', '수정 취소');

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    li.appendChild(badge);
    li.appendChild(wrapper);
    li.appendChild(actions);

  } else {
    // ---- 뷰 모드 ----
    li.className = `todo-item${todo.isCompleted ? ' completed' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-checkbox';
    checkbox.checked = todo.isCompleted;
    checkbox.setAttribute('aria-label', `${todo.text} 완료 여부 선택`);

    const textSpan = document.createElement('span');
    textSpan.className = 'todo-text';
    textSpan.textContent = todo.text;    // XSS 방지: textContent 사용
    textSpan.title = '더블클릭하여 수정';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'todo-date';
    dateSpan.textContent = formatDate(todo.createdAt);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'action-btn edit-btn';
    editBtn.innerHTML = '&#9998;';       // ✎ 기호 (고정 리터럴 — 안전)
    editBtn.title = '수정';
    editBtn.setAttribute('aria-label', `${todo.text} 수정`);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'action-btn delete-btn';
    deleteBtn.innerHTML = '&times;';     // × 기호 (고정 리터럴 — 안전)
    deleteBtn.title = '삭제';
    deleteBtn.setAttribute('aria-label', `${todo.text} 삭제`);

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(checkbox);
    li.appendChild(badge);
    li.appendChild(textSpan);
    li.appendChild(dateSpan);
    li.appendChild(actions);
  }

  return li;
}

// ==========================================================================
// 9. 진행률 바 업데이트
// ==========================================================================

/**
 * 진행률 바와 퍼센트 텍스트를 최신 상태로 갱신합니다.
 */
function updateProgressBar() {
  const total     = state.todos.length;
  const completed = state.todos.filter(t => t.isCompleted).length;
  const pct       = total === 0 ? 0 : Math.round((completed / total) * 100);

  if (progressPercentEl) progressPercentEl.textContent = `${pct}%`;
  if (progressFillEl)    progressFillEl.style.width = `${pct}%`;
  if (progressTrackEl) {
    progressTrackEl.setAttribute('aria-valuenow', String(pct));
  }
}

// ==========================================================================
// 10. 렌더링 — renderList
// ==========================================================================

/**
 * 필터링된 Todo 목록을 DOM에 렌더링하고,
 * 카운트 배지·진행률 바·필터 탭 상태를 일괄 동기화합니다.
 */
function renderList() {
  const filtered = getFilteredTodos();

  // 목록 갱신
  todoListEl.replaceChildren();

  if (filtered.length === 0) {
    emptyStateEl.classList.remove('hidden');
    emptyStateEl.setAttribute('aria-hidden', 'false');
  } else {
    emptyStateEl.classList.add('hidden');
    emptyStateEl.setAttribute('aria-hidden', 'true');

    const frag = document.createDocumentFragment();
    filtered.forEach(todo => frag.appendChild(createTodoElement(todo)));
    todoListEl.appendChild(frag);
  }

  // 수정 모드 자동 포커스
  if (state.editingId) {
    const editInput = todoListEl.querySelector(
      `li[data-id="${state.editingId}"] .edit-todo-input`
    );
    if (editInput) {
      editInput.focus();
      editInput.select();
    }
  }

  // 통계 계산
  const total     = state.todos.length;
  const active    = state.todos.filter(t => !t.isCompleted).length;
  const completed = total - active;

  // 헤더 배지
  if (todoBadgeEl) todoBadgeEl.textContent = `${total}개`;

  // 하단 요약
  if (footerSummaryEl) {
    footerSummaryEl.textContent = `진행 중 ${active}개 · 완료 ${completed}개`;
  }

  // 진행률 바
  updateProgressBar();

  // 필터 탭 상태 동기화
  filterButtons.forEach(btn => {
    const isCurrent = btn.dataset.filter === state.filter;
    btn.classList.toggle('active', isCurrent);
    btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
  });
}

// 하위 호환 별칭
const render = renderList;

// ==========================================================================
// 11. 비즈니스 액션
// ==========================================================================

/**
 * 입력 검증 후 신규 Todo를 추가합니다.
 * @param {string}       text
 * @param {TodoCategory} category
 * @returns {boolean} 추가 성공 여부
 */
function addTodo(text, category) {
  const trimmed = typeof text === 'string' ? text.trim() : '';

  if (!trimmed) {
    showError('할 일을 1자 이상 입력해 주세요.');
    return false;
  }
  if (trimmed.length > 100) {
    showError('할 일은 최대 100자까지 입력 가능합니다.');
    return false;
  }

  clearError();

  /** @type {TodoItem} */
  const newTodo = {
    id: 'todo_' + Date.now(),
    text: trimmed,
    category: ['personal', 'work'].includes(category) ? category : 'personal',
    isCompleted: false,
    createdAt: new Date().toISOString()
  };

  state.todos.unshift(newTodo);
  saveTodos();

  if (todoInputEl) {
    todoInputEl.value = '';
    todoInputEl.focus();
  }

  // 자동 분류 피드백 초기화
  if (categorySuggestHintEl) {
    categorySuggestHintEl.classList.add('hidden');
    categorySuggestHintEl.textContent = '';
  }
  if (todoCategoryEl) {
    todoCategoryEl.classList.remove('auto-highlight');
  }

  renderList();
  return true;
}

/**
 * Todo를 인라인 수정 모드로 전환합니다.
 * @param {string} id
 */
function startEdit(id) {
  if (!state.todos.find(t => t.id === id)) return;
  state.editingId = id;
  renderList();
}

/**
 * 인라인 수정을 취소하고 원래 상태로 복귀합니다.
 */
function cancelEdit() {
  state.editingId = null;
  renderList();
}

/**
 * 수정된 텍스트를 검증·저장하고 수정 모드를 종료합니다.
 * @param {string} id
 * @param {string} newText
 * @returns {boolean}
 */
function updateTodo(id, newText) {
  const trimmed = typeof newText === 'string' ? newText.trim() : '';

  const getEditInput = () =>
    todoListEl.querySelector(`li[data-id="${id}"] .edit-todo-input`);

  if (!trimmed) {
    const el = getEditInput();
    if (el) { el.classList.add('invalid'); el.focus(); }
    return false;
  }
  if (trimmed.length > 100) {
    const el = getEditInput();
    if (el) { el.classList.add('invalid'); el.focus(); }
    return false;
  }

  const target = state.todos.find(t => t.id === id);
  if (target) {
    target.text = trimmed;
    saveTodos();
  }

  state.editingId = null;
  renderList();
  return true;
}

/**
 * Todo 완료 상태를 토글합니다.
 * @param {string} id
 */
function toggleTodo(id) {
  const target = state.todos.find(t => t.id === id);
  if (target) {
    target.isCompleted = !target.isCompleted;
    saveTodos();
    renderList();
  }
}

// 하위 호환 별칭
const toggleTodoComplete = toggleTodo;

/**
 * 특정 Todo를 삭제합니다.
 * @param {string} id
 */
function deleteTodo(id) {
  const idx = state.todos.findIndex(t => t.id === id);
  if (idx !== -1) {
    state.todos.splice(idx, 1);
    saveTodos();
    renderList();
  }
}

/**
 * 완료된 모든 Todo를 일괄 삭제합니다.
 */
function clearCompleted() {
  if (!state.todos.some(t => t.isCompleted)) return;
  state.todos = state.todos.filter(t => !t.isCompleted);
  saveTodos();
  renderList();
}

/**
 * 카테고리 필터를 변경합니다.
 * @param {'all' | 'personal' | 'work'} nextFilter
 */
function setFilter(nextFilter) {
  state.filter = nextFilter;
  renderList();
}

// ==========================================================================
// 12. 이벤트 등록 & 초기화
// ==========================================================================

function initApp() {
  // ① LocalStorage 가용성 탐지
  state.storageAvailable = detectStorageAvailability();
  if (!state.storageAvailable) {
    showStorageErrorBanner();
    console.warn('[TodoApp] LocalStorage를 사용할 수 없습니다 (시크릿 모드 또는 권한 오류).');
  }

  // ② 저장 데이터 로드
  state.todos = loadTodos();

  // ③ 폼 제출 (추가 버튼 / Enter)
  todoFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    addTodo(todoInputEl.value, todoCategoryEl.value);
  });

  // ④ 한글 IME 안전 방어 (modern-web-guidance 가이드 준수)
  todoInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) return;
  });

  // ⑤ 타이핑 시 에러 자동 해제 및 키워드 기반 자동 카테고리 분류
  todoInputEl.addEventListener('input', () => {
    if (todoInputEl.classList.contains('invalid')) clearError();
    handleCategoryAutoDetection(todoInputEl.value);
  });

  // 카테고리 수동 선택 시 자동 하이라이트 해제
  todoCategoryEl.addEventListener('change', () => {
    todoCategoryEl.classList.remove('auto-highlight');
    if (categorySuggestHintEl) {
      categorySuggestHintEl.classList.add('hidden');
    }
  });

  // ⑥ 목록 이벤트 위임 — change (체크박스 토글)
  todoListEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-checkbox')) {
      const item = e.target.closest('.todo-item');
      if (item?.dataset.id) toggleTodo(item.dataset.id);
    }
  });

  // ⑦ 목록 이벤트 위임 — click (삭제/수정/저장/취소 버튼)
  todoListEl.addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item?.dataset.id) return;
    const id = item.dataset.id;

    if (e.target.closest('.delete-btn')) { deleteTodo(id); return; }
    if (e.target.closest('.edit-btn'))   { startEdit(id);  return; }

    if (e.target.closest('.save-btn')) {
      const inp = item.querySelector('.edit-todo-input');
      if (inp) updateTodo(id, inp.value);
      return;
    }
    if (e.target.closest('.cancel-btn')) { cancelEdit(); return; }
  });

  // ⑧ 목록 이벤트 위임 — dblclick (텍스트 더블클릭으로 수정 진입)
  todoListEl.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.todo-text');
    if (textEl) {
      const item = textEl.closest('.todo-item');
      if (item?.dataset.id) startEdit(item.dataset.id);
    }
  });

  // ⑨ 목록 이벤트 위임 — keydown (수정 모드 Enter/Esc, IME 방어 포함)
  todoListEl.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('edit-todo-input')) return;
    const item = e.target.closest('.todo-item');
    const id   = item?.dataset.id;

    if (e.key === 'Enter') {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (id) updateTodo(id, e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  // ⑩ 카테고리 필터 탭
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (f) setFilter(f);
    });
  });

  // ⑪ 완료 항목 일괄 삭제
  clearCompletedBtn.addEventListener('click', clearCompleted);

  // ⑫ 초기 렌더링
  renderList();
}

// DOM 준비 완료 후 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// 디버깅/테스트용 전역 노출
if (typeof window !== 'undefined') {
  window.__TODO_APP__ = {
    state,
    CATEGORY_KEYWORDS,
    detectCategory,
    handleCategoryAutoDetection,
    loadTodos, saveTodos,
    addTodo,
    startEdit, cancelEdit, updateTodo,
    toggleTodo, toggleTodoComplete,
    deleteTodo, clearCompleted,
    setFilter, renderList, render,
    updateProgressBar,
    escapeHTML, showError, clearError
  };
}
