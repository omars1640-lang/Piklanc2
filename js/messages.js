import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
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

let currentProfile = null;
let conversations = [];
let activeChat = null;
let selectedFile = null;
let activeFilter = "all";
let unsubscribeChats = null;
let unsubscribeMessages = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function initials(name) {
  return (name || "م").trim().charAt(0).toUpperCase();
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("ar-SY")} ل.س` : "";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timestampDate(timestamp) {
  return timestamp?.toDate?.() || null;
}

function formatConversationTime(timestamp) {
  const date = timestampDate(timestamp);
  if (!date) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ar-SY", { month: "short", day: "numeric" });
}

function formatDay(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "اليوم";
  if (date.toDateString() === yesterday.toDateString()) return "أمس";
  return date.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" });
}

function otherParticipant(chat) {
  const uid = chat.participantUids.find(participant => participant !== auth.currentUser.uid);
  return {
    uid,
    name: chat.participantNames?.[uid] || "مستخدم PikLance",
    type: chat.participantTypes?.[uid] || "member"
  };
}

function unreadFor(chat) {
  return Number(chat.unreadCounts?.[auth.currentUser.uid] || 0);
}

function renderConversationList() {
  const term = elements.search.value.trim().toLowerCase();
  const visible = conversations.filter(chat => {
    const person = otherParticipant(chat);
    const matchesFilter = activeFilter === "all" || unreadFor(chat) > 0;
    const haystack = `${person.name} ${chat.lastMessage || ""} ${chat.context?.title || ""}`.toLowerCase();
    return matchesFilter && (!term || haystack.includes(term));
  });

  elements.conversationCount.textContent = conversations.length;
  elements.unreadCount.textContent = conversations.reduce((total, chat) => total + unreadFor(chat), 0);
  elements.conversationList.replaceChildren();

  if (!visible.length) {
    const state = document.createElement("div");
    state.className = "empty-list";
    state.innerHTML = term || activeFilter === "unread"
      ? "<span>⌕</span><strong>لا توجد نتائج</strong><p>جرّب كلمة بحث أخرى أو اعرض كل المحادثات.</p>"
      : "<span>✉</span><strong>لا توجد محادثات بعد</strong><p>ابدأ محادثة من صفحة مستقل أو من تفاصيل إحدى الخدمات.</p>";
    elements.conversationList.appendChild(state);
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
    avatar.textContent = initials(person.name);

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const top = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = person.name;
    const time = document.createElement("time");
    time.textContent = formatConversationTime(chat.lastUpdated);
    top.append(name, time);
    const preview = document.createElement("p");
    const senderPrefix = chat.lastSenderUid === auth.currentUser.uid ? "أنت: " : "";
    preview.textContent = `${senderPrefix}${chat.lastMessage || "ابدأ المحادثة الآن"}`;
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

function setPersonDetails(chat) {
  const person = otherParticipant(chat);
  const role = person.type === "freelancer" ? "مستقل على PikLance" : "عميل على PikLance";
  const profileHref = person.type === "freelancer"
    ? `freelancer-profile.html?uid=${encodeURIComponent(person.uid)}`
    : "profile.html";

  document.getElementById("chatPersonName").textContent = person.name;
  document.getElementById("chatPersonRole").textContent = role;
  document.getElementById("chatAvatar").textContent = initials(person.name);
  document.getElementById("chatProfileLink").href = profileHref;
  document.getElementById("detailsName").textContent = person.name;
  document.getElementById("detailsRole").textContent = role;
  document.getElementById("detailsAvatar").textContent = initials(person.name);
  document.getElementById("detailsProfileLink").href = profileHref;

  const context = chat.context;
  const contextCard = document.getElementById("serviceContext");
  const detailsService = document.getElementById("detailsService");
  if (context?.serviceId) {
    const serviceHref = `service-details.html?id=${encodeURIComponent(context.serviceId)}${context.sellerUid ? `&sellerUid=${encodeURIComponent(context.sellerUid)}` : ""}`;
    contextCard.hidden = false;
    contextCard.href = serviceHref;
    document.getElementById("contextTitle").textContent = context.title || "تفاصيل الخدمة";
    document.getElementById("contextPrice").textContent = formatPrice(context.price);
    const image = document.getElementById("contextImage");
    image.src = context.image || "";
    image.alt = context.title || "صورة الخدمة";
    detailsService.hidden = false;
    document.getElementById("detailsServiceTitle").textContent = context.title || "الخدمة المرتبطة";
    document.getElementById("detailsServiceLink").href = serviceHref;
  } else {
    contextCard.hidden = true;
    detailsService.hidden = true;
  }
}

async function markConversationRead(chat) {
  if (!unreadFor(chat)) return;
  try {
    await updateDoc(doc(db, "chats", chat.id), {
      [`unreadCounts.${auth.currentUser.uid}`]: 0
    });
  } catch (error) {
    console.error("Unable to mark conversation read", error);
  }
}

async function markMessagesRead(snapshot) {
  const unreadDocs = snapshot.docs.filter(messageDoc => {
    const message = messageDoc.data();
    return message.senderUid !== auth.currentUser.uid && !message.readBy?.includes(auth.currentUser.uid);
  });
  if (!unreadDocs.length) return;
  const batch = writeBatch(db);
  unreadDocs.slice(0, 100).forEach(messageDoc => {
    batch.update(messageDoc.ref, { readBy: arrayUnion(auth.currentUser.uid) });
  });
  try {
    await batch.commit();
  } catch (error) {
    console.error("Unable to update read receipts", error);
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
    image.alt = attachment.name;
    link.appendChild(image);
  }
  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = attachment.contentType?.startsWith("image/") ? "صورة" : "ملف";
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = attachment.name;
  const size = document.createElement("small");
  size.textContent = formatFileSize(attachment.size || 0);
  copy.append(name, size);
  link.append(icon, copy);
  return link;
}

function renderMessages(snapshot) {
  const previousBottomDistance = elements.stream.scrollHeight - elements.stream.scrollTop - elements.stream.clientHeight;
  elements.stream.replaceChildren();
  if (snapshot.empty) {
    const state = document.createElement("div");
    state.className = "stream-state";
    state.textContent = "ابدأ المحادثة برسالة واضحة عن المطلوب والمدة والميزانية.";
    elements.stream.appendChild(state);
    return;
  }

  let currentDay = "";
  snapshot.forEach(messageDoc => {
    const message = messageDoc.data();
    const date = timestampDate(message.timestamp) || new Date();
    const day = date.toDateString();
    if (day !== currentDay) {
      currentDay = day;
      const divider = document.createElement("span");
      divider.className = "day-divider";
      divider.textContent = formatDay(date);
      elements.stream.appendChild(divider);
    }

    const mine = message.senderUid === auth.currentUser.uid;
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
      const wasRead = message.readBy?.includes(otherUid);
      read.className = `read-state ${wasRead ? "read" : ""}`;
      read.textContent = wasRead ? "تمت القراءة" : "تم الإرسال";
      meta.appendChild(read);
    }
    row.append(bubble, meta);
    elements.stream.appendChild(row);
  });

  if (previousBottomDistance < 100 || snapshot.docChanges().some(change => change.type === "added")) {
    requestAnimationFrame(() => {
      elements.stream.scrollTop = elements.stream.scrollHeight;
    });
  }
  markMessagesRead(snapshot);
}

function subscribeToMessages(chatId) {
  unsubscribeMessages?.();
  elements.stream.innerHTML = '<div class="stream-state">جاري تحميل الرسائل...</div>';
  const messagesQuery = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubscribeMessages = onSnapshot(messagesQuery, renderMessages, error => {
    console.error("Message subscription failed", error);
    elements.stream.innerHTML = '<div class="stream-state">تعذر تحميل الرسائل. تحقق من الاتصال وحاول مجدداً.</div>';
  });
}

async function upgradeLegacyChat(chat) {
  if (chat.participantTypes && chat.unreadCounts && chat.lastMessageType && chat.lastSenderUid !== undefined) {
    return chat;
  }
  const person = otherParticipant(chat);
  const otherProfileSnapshot = await getDoc(doc(db, "publicProfiles", person.uid));
  const otherType = otherProfileSnapshot.exists() ? otherProfileSnapshot.data().accountType : "buyer";
  const participantTypes = {
    [auth.currentUser.uid]: currentProfile.accountType,
    [person.uid]: otherType
  };
  const unreadCounts = {
    [auth.currentUser.uid]: 0,
    [person.uid]: 0
  };
  await setDoc(doc(db, "chats", chat.id), {
    participantTypes,
    unreadCounts,
    lastMessageType: "text",
    lastSenderUid: ""
  }, { merge: true });
  return { ...chat, participantTypes, unreadCounts, lastMessageType: "text", lastSenderUid: "" };
}

async function openConversation(chatId) {
  const chat = conversations.find(item => item.id === chatId);
  if (!chat) return;
  try {
    activeChat = await upgradeLegacyChat(chat);
  } catch (error) {
    console.error("Unable to upgrade legacy conversation", error);
    showToast("تعذر تجهيز المحادثة القديمة للإرسال.");
    return;
  }
  elements.chatEmpty.hidden = true;
  elements.workspace.hidden = false;
  elements.details.hidden = window.innerWidth <= 1180;
  document.getElementById("detailsToggle").setAttribute("aria-expanded", String(!elements.details.hidden));
  elements.shell.classList.add("chat-open");
  setPersonDetails(activeChat);
  renderConversationList();
  subscribeToMessages(activeChat.id);
  markConversationRead(activeChat);
  const url = new URL(location.href);
  url.searchParams.set("chat", activeChat.id);
  history.replaceState({}, "", url);
}

function subscribeToConversations() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("participantUids", "array-contains", auth.currentUser.uid),
    orderBy("lastUpdated", "desc")
  );
  unsubscribeChats = onSnapshot(chatsQuery, snapshot => {
    conversations = snapshot.docs.map(chatDoc => ({ id: chatDoc.id, ...chatDoc.data() }));
    if (activeChat) {
      activeChat = conversations.find(chat => chat.id === activeChat.id) || null;
      if (activeChat) setPersonDetails(activeChat);
    }
    renderConversationList();

    const requestedChat = new URLSearchParams(location.search).get("chat");
    if (!activeChat && requestedChat && conversations.some(chat => chat.id === requestedChat)) {
      openConversation(requestedChat);
    }
  }, error => {
    console.error("Conversation subscription failed", error);
    elements.conversationList.innerHTML = '<div class="empty-list"><span>!</span><strong>تعذر تحميل المحادثات</strong><p>قد تحتاج إلى إنشاء فهرس Firestore للاستعلام أو التحقق من الاتصال.</p></div>';
  });
}

function safeId(value) {
  return String(value || "direct").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

async function startRequestedConversation() {
  const params = new URLSearchParams(location.search);
  const otherUid = params.get("withUid");
  if (!otherUid || otherUid === auth.currentUser.uid) return null;

  const otherProfileSnapshot = await getDoc(doc(db, "publicProfiles", otherUid));
  if (!otherProfileSnapshot.exists()) {
    showToast("تعذر العثور على حساب المستقل المطلوب.");
    return null;
  }

  const otherProfile = otherProfileSnapshot.data();
  const ids = [auth.currentUser.uid, otherUid].sort();
  const serviceId = params.get("serviceId");
  const chatId = `${ids.join("_")}__${safeId(serviceId)}`;
  const chatReference = doc(db, "chats", chatId);
  const existing = await getDoc(chatReference);
  if (!existing.exists()) {
    const participantNames = {
      [auth.currentUser.uid]: currentProfile.name || auth.currentUser.email,
      [otherUid]: otherProfile.name
    };
    const participantTypes = {
      [auth.currentUser.uid]: currentProfile.accountType,
      [otherUid]: otherProfile.accountType
    };
    const unreadCounts = {
      [auth.currentUser.uid]: 0,
      [otherUid]: 0
    };
    const data = {
      participantUids: ids,
      participantNames,
      participantTypes,
      unreadCounts,
      lastMessage: "",
      lastMessageType: "text",
      lastSenderUid: "",
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    };
    if (serviceId) {
      const requestedSellerUid = params.get("sellerUid");
      const contextSellerUid = ids.includes(requestedSellerUid)
        ? requestedSellerUid
        : participantTypes[auth.currentUser.uid] === "freelancer"
          ? auth.currentUser.uid
          : otherUid;
      data.context = {
        serviceId: safeId(serviceId),
        title: (params.get("serviceTitle") || "خدمة على PikLance").slice(0, 140),
        image: (params.get("serviceImage") || "").slice(0, 600),
        price: Number(params.get("servicePrice") || 0),
        sellerUid: contextSellerUid
      };
    }
    await setDoc(chatReference, data);
  }
  return chatId;
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
  document.getElementById("attachmentKind").textContent = file.type.startsWith("image/") ? "صورة" : "ملف";
  document.getElementById("attachmentName").textContent = file.name;
  document.getElementById("attachmentSize").textContent = formatFileSize(file.size);
}

async function uploadAttachment(file, chatId, messageId) {
  const cleanName = file.name.replace(/[^\w.\-]+/g, "-").slice(-100);
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

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.input.value.trim();
  if ((!text && !selectedFile) || !activeChat) return;
  elements.send.disabled = true;
  elements.send.querySelector("span").textContent = selectedFile ? "جارٍ الرفع" : "جارٍ الإرسال";

  const messageReference = doc(collection(db, "chats", activeChat.id, "messages"));
  let attachment = null;
  try {
    if (selectedFile) attachment = await uploadAttachment(selectedFile, activeChat.id, messageReference.id);
    const otherUid = otherParticipant(activeChat).uid;
    const batch = writeBatch(db);
    const message = {
      text,
      senderUid: auth.currentUser.uid,
      timestamp: serverTimestamp(),
      type: attachment ? (text ? "mixed" : "attachment") : "text",
      readBy: [auth.currentUser.uid]
    };
    if (attachment) message.attachment = attachment;
    batch.set(messageReference, message);
    batch.update(doc(db, "chats", activeChat.id), {
      lastMessage: (text || `مرفق: ${attachment.name}`).slice(0, 140),
      lastMessageType: message.type,
      lastSenderUid: auth.currentUser.uid,
      lastUpdated: serverTimestamp(),
      [`unreadCounts.${auth.currentUser.uid}`]: 0,
      [`unreadCounts.${otherUid}`]: increment(1)
    });
    await batch.commit();
    elements.input.value = "";
    elements.input.style.height = "";
    elements.limit.textContent = "0/2000";
    setSelectedFile(null);
  } catch (error) {
    console.error("Unable to send message", error);
    if (attachment?.path) {
      deleteObject(ref(storage, attachment.path)).catch(() => {});
    }
    showToast("تعذر إرسال الرسالة. تحقق من الاتصال وحاول مجدداً.");
  } finally {
    elements.send.disabled = false;
    elements.send.querySelector("span").textContent = "إرسال";
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

bindEvents();

onAuthStateChanged(auth, async user => {
  if (!user) {
    const returnUrl = encodeURIComponent(`${location.pathname}${location.search}`);
    location.replace(`login.html?returnUrl=${returnUrl}`);
    return;
  }
  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!user.emailVerified || !profileSnapshot.exists() || profileSnapshot.data().status !== "active") {
      await signOut(auth);
      location.replace("login.html");
      return;
    }
    currentProfile = profileSnapshot.data();
    subscribeToConversations();
    const requestedChatId = await startRequestedConversation();
    if (requestedChatId) {
      const url = new URL(location.href);
      url.searchParams.delete("withUid");
      url.searchParams.delete("serviceTitle");
      url.searchParams.delete("serviceImage");
      url.searchParams.delete("servicePrice");
      url.searchParams.set("chat", requestedChatId);
      history.replaceState({}, "", url);
      const snapshot = await getDoc(doc(db, "chats", requestedChatId));
      if (snapshot.exists()) {
        const requestedChat = { id: snapshot.id, ...snapshot.data() };
        if (!conversations.some(chat => chat.id === requestedChat.id)) conversations.unshift(requestedChat);
        await openConversation(requestedChat.id);
      }
    }
  } catch (error) {
    console.error("Unable to initialize messages", error);
    showToast("تعذر فتح نظام الرسائل. تأكد من حالة الحساب والاتصال.");
  } finally {
    elements.loading.classList.add("hidden");
  }
});

window.addEventListener("beforeunload", () => {
  unsubscribeChats?.();
  unsubscribeMessages?.();
});
