import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "application/x-zip-compressed"
]);

const elements = {
  shell: document.querySelector(".messenger-shell"),
  conversationList: document.getElementById("conversationList"),
  conversationCount: document.getElementById("conversationCount"),
  unreadCount: document.getElementById("unreadCount"),
  search: document.getElementById("conversationSearch"),
  chatEmpty: document.getElementById("chatEmpty"),
  workspace: document.getElementById("chatWorkspace"),
  stream: document.getElementById("messageStream"),
  form: document.getElementById("messageForm"),
  input: document.getElementById("messageInput"),
  limit: document.getElementById("composerLimit"),
  send: document.getElementById("sendButton"),
  fileInput: document.getElementById("attachmentInput"),
  attachmentPreview: document.getElementById("attachmentPreview"),
  details: document.getElementById("chatDetails"),
  toast: document.getElementById("messageToast"),
  loading: document.getElementById("authLoading")
};

let currentUser = null;
let currentProfile = null;
let conversations = [];
let activeChat = null;
let selectedFile = null;
let activeFilter = "all";
let unsubscribeChats = null;
let unsubscribeMessages = null;

const initialParams = new URLSearchParams(location.search);
const hasRequestedConversation = initialParams.has("withUid") || initialParams.has("chat");

function text(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

function setStreamState(message) {
  elements.stream.replaceChildren();
  const state = document.createElement("div");
  state.className = "stream-state";
  state.textContent = message;
  elements.stream.appendChild(state);
}

function showChatWorkspace() {
  elements.chatEmpty.hidden = true;
  elements.workspace.hidden = false;
  elements.shell.classList.add("chat-open");
}

function showConversationOpenError(message) {
  showChatWorkspace();
  elements.shell.classList.remove("chat-booting");
  setStreamState(message);
}

function initial(value) {
  return (value || "م").trim().charAt(0).toUpperCase();
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number.toLocaleString("ar-SY")} ل.س` : "";
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toDate(timestamp) {
  return timestamp?.toDate?.() || null;
}

function sortByUpdatedAt(items) {
  return [...items].sort((a, b) => {
    const left = toDate(a.lastUpdated)?.getTime() || 0;
    const right = toDate(b.lastUpdated)?.getTime() || 0;
    return right - left;
  });
}

function conversationTime(timestamp) {
  const date = toDate(timestamp);
  if (!date) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ar-SY", { month: "short", day: "numeric" });
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "اليوم";
  if (date.toDateString() === yesterday.toDateString()) return "أمس";
  return date.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" });
}

function otherParticipant(chat) {
  const uid = chat.participantUids?.find(participant => participant !== currentUser.uid);
  return {
    uid,
    name: chat.participantNames?.[uid] || "مستخدم PikLance",
    type: chat.participantTypes?.[uid] || "buyer"
  };
}

function unreadFor(chat) {
  return Number(chat.unreadCounts?.[currentUser.uid] || 0);
}

function profileLink(person) {
  return person.type === "freelancer"
    ? `freelancer-profile.html?uid=${encodeURIComponent(person.uid)}`
    : "profile.html";
}

function safeChatPart(value) {
  return String(value || "direct")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80) || "direct";
}

function requestedChatId(otherUid, serviceId) {
  return `${[currentUser.uid, otherUid].sort().join("_")}__${safeChatPart(serviceId)}`;
}

async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) throw new Error(`missing-user:${uid}`);
  return { id: uid, ...snapshot.data() };
}

async function getPublicProfile(uid) {
  const snapshot = await getDoc(doc(db, "publicProfiles", uid));
  if (!snapshot.exists()) throw new Error(`missing-public-profile:${uid}`);
  return { id: uid, ...snapshot.data() };
}

function normalizeContext(params, participantUids, participantTypes) {
  const serviceId = params.get("serviceId");
  if (!serviceId) return null;
  const requestedSellerUid = params.get("sellerUid");
  const sellerUid = participantUids.includes(requestedSellerUid)
    ? requestedSellerUid
    : participantTypes[currentUser.uid] === "freelancer"
      ? currentUser.uid
      : participantUids.find(uid => uid !== currentUser.uid);

  const price = Number(params.get("servicePrice"));
  return {
    serviceId: safeChatPart(serviceId),
    title: (params.get("serviceTitle") || "خدمة على PikLance").slice(0, 140),
    image: (params.get("serviceImage") || "").slice(0, 1200),
    price: Number.isFinite(price) ? price : 0,
    sellerUid
  };
}

async function ensureRequestedConversation() {
  const params = new URLSearchParams(location.search);
  const otherUid = params.get("withUid");
  if (!otherUid || otherUid === currentUser.uid) return null;

  const [mine, other] = await Promise.all([
    getUserProfile(currentUser.uid),
    getPublicProfile(otherUid)
  ]);
  if (mine.status !== "active" || other.status !== "active") {
    throw new Error("inactive-participant");
  }

  const serviceId = params.get("serviceId");
  const chatId = requestedChatId(otherUid, serviceId);
  const chatReference = doc(db, "chats", chatId);
  const existing = await getDoc(chatReference);
  if (existing.exists()) return chatId;

  const participantUids = [currentUser.uid, otherUid].sort();
  const participantNames = {
    [currentUser.uid]: mine.name,
    [otherUid]: other.name
  };
  const participantTypes = {
    [currentUser.uid]: mine.accountType,
    [otherUid]: other.accountType
  };
  const unreadCounts = {
    [currentUser.uid]: 0,
    [otherUid]: 0
  };
  const context = normalizeContext(params, participantUids, participantTypes);

  await setDoc(chatReference, {
    participantUids,
    participantNames,
    participantTypes,
    unreadCounts,
    lastMessage: "",
    lastMessageType: "text",
    lastSenderUid: "",
    createdAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
    ...(context ? { context } : {})
  });
  return chatId;
}

function renderConversationList() {
  const term = elements.search.value.trim().toLowerCase();
  const visible = conversations.filter(chat => {
    const person = otherParticipant(chat);
    const haystack = `${person.name} ${chat.lastMessage || ""} ${chat.context?.title || ""}`.toLowerCase();
    return (activeFilter === "all" || unreadFor(chat) > 0) && (!term || haystack.includes(term));
  });

  elements.conversationCount.textContent = conversations.length;
  elements.unreadCount.textContent = conversations.reduce((sum, chat) => sum + unreadFor(chat), 0);
  elements.conversationList.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    const icon = document.createElement("span");
    icon.textContent = term ? "⌕" : "✉";
    const title = document.createElement("strong");
    title.textContent = term || activeFilter === "unread" ? "لا توجد نتائج" : "لا توجد محادثات بعد";
    const copy = document.createElement("p");
    copy.textContent = term || activeFilter === "unread"
      ? "جرّب كلمة بحث أخرى أو اعرض كل المحادثات."
      : "ابدأ محادثة من صفحة مستقل أو من تفاصيل إحدى الخدمات.";
    empty.append(icon, title, copy);
    elements.conversationList.appendChild(empty);
    return;
  }

  visible.forEach(chat => {
    const person = otherParticipant(chat);
    const unread = unreadFor(chat);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("active", activeChat?.id === chat.id);

    const avatar = document.createElement("span");
    avatar.className = "conversation-avatar";
    avatar.textContent = initial(person.name);

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const top = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = person.name;
    const time = document.createElement("time");
    time.textContent = conversationTime(chat.lastUpdated);
    top.append(name, time);

    const preview = document.createElement("p");
    preview.textContent = `${chat.lastSenderUid === currentUser.uid ? "أنت: " : ""}${chat.lastMessage || "ابدأ المحادثة الآن"}`;
    copy.append(top, preview);

    if (chat.context?.title) {
      const service = document.createElement("span");
      service.className = "conversation-service";
      service.textContent = chat.context.title;
      copy.appendChild(service);
    }

    const badge = document.createElement("span");
    if (unread) {
      badge.className = "unread-badge";
      badge.textContent = unread > 99 ? "99+" : unread;
    }

    button.append(avatar, copy, badge);
    button.addEventListener("click", () => openConversation(chat.id));
    elements.conversationList.appendChild(button);
  });
}

function renderConversationDetails(chat) {
  const person = otherParticipant(chat);
  const role = person.type === "freelancer" ? "مستقل على PikLance" : "عميل على PikLance";
  const href = profileLink(person);

  text("chatPersonName", person.name);
  text("chatPersonRole", role);
  text("chatAvatar", initial(person.name));
  text("detailsName", person.name);
  text("detailsRole", role);
  text("detailsAvatar", initial(person.name));
  document.getElementById("chatProfileLink").href = href;
  document.getElementById("detailsProfileLink").href = href;

  const contextCard = document.getElementById("serviceContext");
  const detailsService = document.getElementById("detailsService");
  const context = chat.context;
  if (!context?.serviceId) {
    contextCard.hidden = true;
    detailsService.hidden = true;
    return;
  }

  const serviceHref = `service-details.html?id=${encodeURIComponent(context.serviceId)}${context.sellerUid ? `&sellerUid=${encodeURIComponent(context.sellerUid)}` : ""}`;
  contextCard.hidden = false;
  contextCard.href = serviceHref;
  text("contextTitle", context.title || "تفاصيل الخدمة");
  text("contextPrice", formatPrice(context.price));
  const image = document.getElementById("contextImage");
  image.src = context.image || "assets/service-placeholder.svg";
  image.alt = context.title || "صورة الخدمة";

  detailsService.hidden = false;
  text("detailsServiceTitle", context.title || "الخدمة المرتبطة");
  document.getElementById("detailsServiceLink").href = serviceHref;
}

async function markConversationRead(chat) {
  if (!unreadFor(chat)) return;
  try {
    await updateDoc(doc(db, "chats", chat.id), {
      [`unreadCounts.${currentUser.uid}`]: 0
    });
  } catch (error) {
    console.warn("Unable to mark conversation read", error);
  }
}

function renderAttachment(message) {
  const attachment = message.attachment;
  const link = document.createElement("a");
  link.className = "message-attachment";
  link.href = attachment.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  if (attachment.contentType?.startsWith("image/")) {
    link.classList.add("has-image");
    const image = document.createElement("img");
    image.className = "message-attachment-preview";
    image.src = attachment.url;
    image.alt = attachment.name || "مرفق";
    link.appendChild(image);
  }

  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = attachment.contentType?.startsWith("image/") ? "صورة" : "ملف";
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = attachment.name || "مرفق";
  const size = document.createElement("small");
  size.textContent = formatFileSize(attachment.size);
  copy.append(name, size);
  link.append(icon, copy);
  return link;
}

function markMessagesRead(snapshot) {
  snapshot.docs
    .filter(messageDoc => {
      const message = messageDoc.data();
      return message.senderUid !== currentUser.uid && !message.readBy?.includes(currentUser.uid);
    })
    .slice(0, 50)
    .forEach(messageDoc => {
      updateDoc(messageDoc.ref, { readBy: arrayUnion(currentUser.uid) }).catch(error => {
        console.warn("Unable to mark message read", error);
      });
    });
}

function renderMessages(snapshot) {
  const shouldStickToBottom = elements.stream.scrollHeight - elements.stream.scrollTop - elements.stream.clientHeight < 120;
  elements.stream.replaceChildren();

  if (snapshot.empty) {
    setStreamState("ابدأ المحادثة برسالة واضحة عن المطلوب والمدة والميزانية.");
    return;
  }

  let currentDay = "";
  snapshot.forEach(messageDoc => {
    const message = messageDoc.data();
    const date = toDate(message.timestamp) || new Date();
    const day = date.toDateString();
    if (day !== currentDay) {
      currentDay = day;
      const divider = document.createElement("span");
      divider.className = "day-divider";
      divider.textContent = dayLabel(date);
      elements.stream.appendChild(divider);
    }

    const mine = message.senderUid === currentUser.uid;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : "theirs"}`;
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (message.attachment?.url) bubble.appendChild(renderAttachment(message));
    if (message.text) bubble.appendChild(document.createTextNode(message.text));

    const meta = document.createElement("span");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.textContent = date.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
    meta.appendChild(time);
    if (mine) {
      const read = document.createElement("span");
      const otherUid = otherParticipant(activeChat).uid;
      read.className = message.readBy?.includes(otherUid) ? "read-state read" : "read-state";
      read.textContent = message.readBy?.includes(otherUid) ? "تمت القراءة" : "تم الإرسال";
      meta.appendChild(read);
    }

    row.append(bubble, meta);
    elements.stream.appendChild(row);
  });

  if (shouldStickToBottom || snapshot.docChanges().some(change => change.type === "added")) {
    requestAnimationFrame(() => {
      elements.stream.scrollTop = elements.stream.scrollHeight;
    });
  }
  markMessagesRead(snapshot);
}

function subscribeToMessages(chatId) {
  unsubscribeMessages?.();
  setStreamState("جاري تحميل الرسائل...");
  const messagesQuery = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubscribeMessages = onSnapshot(messagesQuery, renderMessages, error => {
    console.error("Message subscription failed", error);
    setStreamState(`تعذر تحميل الرسائل (${error.code || "unknown"}). تحقق من الصلاحيات أو الاتصال.`);
  });
}

async function openConversation(chatId) {
  const chat = conversations.find(item => item.id === chatId);
  if (!chat) return;
  activeChat = chat;
  showChatWorkspace();
  elements.shell.classList.remove("chat-booting");
  elements.details.hidden = window.innerWidth <= 1180;
  document.getElementById("detailsToggle").setAttribute("aria-expanded", String(!elements.details.hidden));
  renderConversationDetails(activeChat);
  renderConversationList();
  subscribeToMessages(activeChat.id);
  markConversationRead(activeChat);

  const url = new URL(location.href);
  url.searchParams.set("chat", activeChat.id);
  ["withUid", "serviceId", "serviceTitle", "serviceImage", "servicePrice", "sellerUid"].forEach(key => url.searchParams.delete(key));
  history.replaceState({}, "", url);
}

function subscribeToConversations() {
  unsubscribeChats?.();
  const chatsQuery = query(collection(db, "chats"), where("participantUids", "array-contains", currentUser.uid));
  unsubscribeChats = onSnapshot(chatsQuery, snapshot => {
    conversations = sortByUpdatedAt(snapshot.docs.map(chatDoc => ({ id: chatDoc.id, ...chatDoc.data() })));
    if (activeChat) {
      activeChat = conversations.find(chat => chat.id === activeChat.id) || activeChat;
      renderConversationDetails(activeChat);
    }
    renderConversationList();

    const chatId = new URLSearchParams(location.search).get("chat");
    if (!activeChat && chatId && conversations.some(chat => chat.id === chatId)) {
      openConversation(chatId);
    }
  }, error => {
    console.error("Conversation subscription failed", error);
    elements.conversationList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = `<span>!</span><strong>تعذر تحميل المحادثات</strong><p>الخطأ: ${error.code || "unknown"}. تحقق من قواعد Firebase أو الاتصال.</p>`;
    elements.conversationList.appendChild(empty);
  });
}

function validateFile(file) {
  if (!file) return false;
  if (file.size > MAX_FILE_SIZE) {
    showToast("حجم الملف يجب ألا يتجاوز 10 ميغابايت.");
    return false;
  }
  if (!allowedTypes.has(file.type)) {
    showToast("نوع الملف غير مدعوم. استخدم صورة أو PDF أو Word أو ZIP.");
    return false;
  }
  return true;
}

function setSelectedFile(file) {
  selectedFile = file;
  elements.attachmentPreview.hidden = !file;
  if (!file) {
    elements.fileInput.value = "";
    return;
  }
  text("attachmentKind", file.type.startsWith("image/") ? "صورة" : "ملف");
  text("attachmentName", file.name);
  text("attachmentSize", formatFileSize(file.size));
}

async function uploadAttachment(file, chatId, messageId) {
  const cleanName = file.name.replace(/[^\w.\-]+/g, "-").slice(-100) || "attachment";
  const path = `chat-attachments/${chatId}/${messageId}/${cleanName}`;
  const attachmentRef = ref(storage, path);
  await uploadBytes(attachmentRef, file, { contentType: file.type });
  return {
    name: file.name.slice(0, 160),
    url: await getDownloadURL(attachmentRef),
    path,
    size: file.size,
    contentType: file.type
  };
}

async function updateConversationAfterMessage(message) {
  const otherUid = otherParticipant(activeChat).uid;
  const currentUnread = Number(activeChat.unreadCounts?.[otherUid] || 0);
  const unreadCounts = {
    ...(activeChat.unreadCounts || {}),
    [currentUser.uid]: 0,
    [otherUid]: currentUnread + 1
  };
  await updateDoc(doc(db, "chats", activeChat.id), {
    lastMessage: (message.text || `مرفق: ${message.attachment?.name || "ملف"}`).slice(0, 140),
    lastMessageType: message.type,
    lastSenderUid: currentUser.uid,
    lastUpdated: serverTimestamp(),
    unreadCounts
  });
}

async function sendMessage(event) {
  event.preventDefault();
  const textValue = elements.input.value.trim();
  if ((!textValue && !selectedFile) || !activeChat) return;

  const originalLabel = elements.send.querySelector("span").textContent;
  elements.send.disabled = true;
  elements.send.querySelector("span").textContent = selectedFile ? "جاري الرفع" : "جاري الإرسال";

  const messageReference = doc(collection(db, "chats", activeChat.id, "messages"));
  let attachment = null;
  try {
    if (selectedFile) attachment = await uploadAttachment(selectedFile, activeChat.id, messageReference.id);
    const message = {
      text: textValue,
      senderUid: currentUser.uid,
      timestamp: serverTimestamp(),
      type: attachment ? (textValue ? "mixed" : "attachment") : "text",
      readBy: [currentUser.uid],
      ...(attachment ? { attachment } : {})
    };
    await setDoc(messageReference, message);
    elements.input.value = "";
    elements.input.style.height = "";
    elements.limit.textContent = "0/2000";
    setSelectedFile(null);

    try {
      await updateConversationAfterMessage(message);
    } catch (summaryError) {
      console.warn("Message saved but conversation summary failed", summaryError);
      showToast("تم إرسال الرسالة، لكن تعذر تحديث ملخص المحادثة مؤقتاً.");
    }
  } catch (error) {
    console.error("Unable to send message", error);
    if (attachment?.path) deleteObject(ref(storage, attachment.path)).catch(() => {});
    showToast(`تعذر إرسال الرسالة (${error.code || "unknown"}).`);
  } finally {
    elements.send.disabled = false;
    elements.send.querySelector("span").textContent = originalLabel;
  }
}

function bindEvents() {
  elements.search.addEventListener("input", renderConversationList);
  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button));
      renderConversationList();
    });
  });
  elements.form.addEventListener("submit", sendMessage);
  elements.input.addEventListener("input", () => {
    elements.limit.textContent = `${elements.input.value.length}/2000`;
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 125)}px`;
  });
  elements.input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  document.getElementById("attachButton").addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files[0];
    if (validateFile(file)) setSelectedFile(file);
    else setSelectedFile(null);
  });
  document.getElementById("removeAttachment").addEventListener("click", () => setSelectedFile(null));
  document.getElementById("mobileBack").addEventListener("click", () => elements.shell.classList.remove("chat-open"));
  document.getElementById("detailsToggle").addEventListener("click", () => {
    elements.details.hidden = !elements.details.hidden;
    document.getElementById("detailsToggle").setAttribute("aria-expanded", String(!elements.details.hidden));
  });
  document.getElementById("detailsClose").addEventListener("click", () => {
    elements.details.hidden = true;
    document.getElementById("detailsToggle").setAttribute("aria-expanded", "false");
  });
}

async function initializeMessages(user) {
  currentUser = user;
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!user.emailVerified || !profileSnapshot.exists() || profileSnapshot.data().status !== "active") {
    await signOut(auth);
    location.replace("login.html");
    return;
  }
  currentProfile = profileSnapshot.data();
  subscribeToConversations();

  const params = new URLSearchParams(location.search);
  if (params.has("withUid")) {
    showChatWorkspace();
    setStreamState("جاري فتح المحادثة...");
    const chatId = await ensureRequestedConversation();
    if (chatId) {
      const snapshot = await getDoc(doc(db, "chats", chatId));
      if (snapshot.exists()) {
        const chat = { id: snapshot.id, ...snapshot.data() };
        if (!conversations.some(item => item.id === chat.id)) conversations.unshift(chat);
        await openConversation(chat.id);
      }
    }
  }
}

bindEvents();

if (hasRequestedConversation) {
  showChatWorkspace();
  elements.shell.classList.add("chat-booting");
  setStreamState("جاري فتح المحادثة...");
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    const returnUrl = encodeURIComponent(`${location.pathname}${location.search}`);
    location.replace(`login.html?returnUrl=${returnUrl}`);
    return;
  }

  try {
    await initializeMessages(user);
  } catch (error) {
    console.error("Unable to initialize messages", error);
    showConversationOpenError(`تعذر فتح نظام الرسائل (${error.code || error.message || "unknown"}).`);
  } finally {
    elements.loading.classList.add("hidden");
  }
});

window.addEventListener("beforeunload", () => {
  unsubscribeChats?.();
  unsubscribeMessages?.();
});
