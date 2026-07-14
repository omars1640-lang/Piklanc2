const wallet = require("./lib/wallet");
const orders = require("./lib/orders");
const email = require("./lib/email");

exports.submitDepositRequest = wallet.submitDepositRequest;
exports.reviewDepositRequest = wallet.reviewDepositRequest;
exports.requestWithdrawal = wallet.requestWithdrawal;
exports.reviewWithdrawalRequest = wallet.reviewWithdrawalRequest;
exports.createWalletOrder = orders.createWalletOrder;
exports.approveWalletOrder = orders.approveWalletOrder;
exports.releaseDueOrders = orders.releaseDueOrders;
exports.sendQueuedEmail = email.sendQueuedEmail;
exports.sendAdminOfficialEmail = email.sendAdminOfficialEmail;
exports.sendOfficialEmail = email.sendOfficialEmail;
exports.sendLaunchSubscriberWelcome = email.sendLaunchSubscriberWelcome;
