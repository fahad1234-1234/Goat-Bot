const fs = require("fs");
const path = require("path");
const { getTime } = global.utils;

// Rate limiting storage
global.logsbotLastEvent = global.logsbotLastEvent || {};
global.botStartTime = global.botStartTime || Date.now();

module.exports = {
	config: {
		name: "logsbot",
		isBot: true,
		version: "2.1",
		author: "NTKhang | Fahad Islam",
		envConfig: { allow: true },
		category: "events",
		description: "Logs bot addition/removal from groups and restart notifications"
	},

	langs: {
		en: {
			title: "╭───────★────────╮\n     🤖 Bot Logs\n╰───────★────────╯",
			added: "\n✅ Bot was added to a new group!\n👑 Added by: %1",
			kicked: "\n❌ Bot was removed from a group!\n🚫 Kicked by: %1",
			countMembers: "\n👥 Total Members: %1",
			groupType: "\n🏷️ Group Type: %1",
			footer: "\n🆔 User ID: %1\n👥 Group Name: %2\n🆔 Group ID: %3\n⏰ Time: %4",
			restartTitle: "╭───────★────────╮\n     🔄 Bot Restart Logs\n╰───────★────────╯",
			restartMessage: "\n✨ Bot has been restarted successfully!\n⏰ Previous Uptime: %1\n📊 Previous Session: %2\n🔄 Restart Time: %3",
			startupTitle: "╭───────★────────╮\n     🟢 Bot Startup Logs\n╰───────★────────╯",
			startupMessage: "\n✨ Bot is now online and ready!\n⏰ Startup Time: %1\n📊 Status: ✅ Operational",
			error: "❌ Error processing bot log event: %1"
		}
	},

	onStart: async ({ usersData, threadsData, event, api, getLang }) => {
		const currentBotID = api.getCurrentUserID();

		// Check if event is bot addition/removal
		const isAdded = event.logMessageType === "log:subscribe"
			&& event.logMessageData?.addedParticipants?.some(p => p.userFbId === currentBotID);

		const isRemoved = event.logMessageType === "log:unsubscribe"
			&& event.logMessageData?.leftParticipantFbId === currentBotID;

		if (!isAdded && !isRemoved) return;

		// Rate limiting - prevent spam
		const now = Date.now();
		const { threadID } = event;
		if (global.logsbotLastEvent[threadID] && (now - global.logsbotLastEvent[threadID] < 3000)) {
			return;
		}
		global.logsbotLastEvent[threadID] = now;

		return async function () {
			const { author, threadID } = event;

			// Prevent self-triggered events
			if (author === currentBotID) return;

			try {
				let msg = getLang("title");
				let threadName = "Unknown Group";
				let memberCount = 0;
				let groupType = "Regular Group";

				if (isAdded) {
					const authorName = await usersData.getName(author);

					// Get detailed thread information
					let threadInfo;
					try {
						threadInfo = await api.getThreadInfo(threadID);
						threadName = threadInfo?.threadName || "Unnamed Group";
						memberCount = threadInfo?.participantIDs?.length || 0;
						groupType = threadInfo?.isSubscribed ? "Premium Group" : "Regular Group";
					} catch (error) {
						console.error("Error fetching thread info:", error);
						threadName = "Unnamed Group";
					}

					msg += getLang("added", authorName);

					// Add member count for new groups
					if (memberCount > 0) {
						msg += getLang("countMembers", memberCount);
					}

					// Add group type
					msg += getLang("groupType", groupType);

				} else if (isRemoved) {
					const authorName = await usersData.getName(author);

					// Get thread data from database
					let threadData;
					try {
						threadData = await threadsData.get(threadID);
						threadName = threadData?.threadName || "Unnamed Group";
						memberCount = threadData?.members?.length || threadData?.participantIDs?.length || 0;
					} catch (error) {
						console.error("Error fetching thread data:", error);
						threadName = "Unnamed Group";
					}

					msg += getLang("kicked", authorName);

					// Add previous member count for removed groups
					if (memberCount > 0) {
						msg += getLang("countMembers", memberCount);
					}
				}

				const time = getTime("DD/MM/YYYY HH:mm:ss");
				msg += getLang("footer", author, threadName, threadID, time);

				await module.exports.sendToAdmins(api, msg, getLang);

				// Log to console for debugging
				console.log(`\n📝 Bot ${isAdded ? 'ADDED' : 'REMOVED'} Event:`);
				console.log(`👤 User: ${author}`);
				console.log(`💬 Group: ${threadName}`);
				console.log(`🆔 Group ID: ${threadID}`);
				console.log(`⏰ Time: ${time}`);
				console.log(`👥 Members: ${memberCount}`);
				console.log(`🏷️ Type: ${groupType}\n`);

			} catch (error) {
				console.error("❌ Critical error in logsbot:", error);
				await module.exports.handleError(api, getLang, error);
			}
		};
	},

	// Send restart notification to all admins
	onRestart: async ({ api, getLang }) => {
		try {
			const currentTime = Date.now();
			const previousUptime = global.botStartTime ? this.formatUptime(currentTime - global.botStartTime) : "Unknown";

			// Update bot start time for next session
			global.botStartTime = currentTime;

			const restartTime = getTime("DD/MM/YYYY HH:mm:ss");

			let msg = getLang("restartTitle");
			msg += getLang("restartMessage", previousUptime, "Completed", restartTime);

			await module.exports.sendToAdmins(api, msg, getLang);

			console.log(`\n🔄 Bot Restart Notification Sent:`);
			console.log(`⏰ Previous Uptime: ${previousUptime}`);
			console.log(`🕒 Restart Time: ${restartTime}\n`);

		} catch (error) {
			console.error("❌ Error sending restart notification:", error);
		}
	},

	// Send startup notification (when bot first starts)
	onReady: async ({ api, getLang }) => {
		try {
			// Only send startup notification if bot was just started
			if (!global.botStartTime) {
				global.botStartTime = Date.now();

				const startupTime = getTime("DD/MM/YYYY HH:mm:ss");

				let msg = getLang("startupTitle");
				msg += getLang("startupMessage", startupTime);

				await module.exports.sendToAdmins(api, msg, getLang);

				console.log(`\n🎉 Bot Startup Notification Sent:`);
				console.log(`🕒 Startup Time: ${startupTime}\n`);
			}
		} catch (error) {
			console.error("❌ Error sending startup notification:", error);
		}
	},

	// Utility function to send messages to all admins
	sendToAdmins: async function(api, message, getLang) {
		try {
			// Handle attachment
			let attachment = null;
			const attachmentOptions = [
				path.join(__dirname, "tmp", "log.gif"),
				path.join(__dirname, "assets", "log.gif"),
				path.join(__dirname, "tmp", "log.jpg"),
				path.join(__dirname, "assets", "log.jpg"),
				path.join(__dirname, "tmp", "log.png"),
				path.join(__dirname, "assets", "log.png")
			];

			for (const attachmentPath of attachmentOptions) {
				if (fs.existsSync(attachmentPath)) {
					attachment = fs.createReadStream(attachmentPath);
					console.log(`📎 Using attachment: ${path.basename(attachmentPath)}`);
					break;
				}
			}

			// Send to all bot admins
			const { logsbot } = global.GoatBot.config;
			if (logsbot && Array.isArray(logsbot) && logsbot.length > 0) {
				const sendPromises = logsbot.map(async (adminID) => {
					try {
						await api.sendMessage({ 
							body: message, 
							attachment 
						}, adminID);

						console.log(`✅ Log sent successfully to admin: ${adminID}`);
						return { success: true, adminID };
					} catch (error) {
						console.error(`❌ Failed to send log to admin ${adminID}:`, error.message);
						return { success: false, adminID, error: error.message };
					}
				});

				const results = await Promise.allSettled(sendPromises);

				// Log summary
				const successfulSends = results.filter(result => 
					result.status === 'fulfilled' && result.value?.success
				).length;

				const failedSends = results.length - successfulSends;

				if (failedSends > 0) {
					console.warn(`📊 Logs sent: ${successfulSends} successful, ${failedSends} failed`);
				} else {
					console.log(`📊 All logs sent successfully to ${successfulSends} admins`);
				}

				return { successful: successfulSends, failed: failedSends };
			} else {
				console.error("❌ No bot admins configured in logsbot array");
				return { successful: 0, failed: 0 };
			}
		} catch (error) {
			console.error("❌ Error in sendToAdmins:", error);
			throw error;
		}
	},

	// Error handling utility
	handleError: async function(api, getLang, error) {
		try {
			const { logsbot } = global.GoatBot.config;
			if (logsbot && Array.isArray(logsbot) && logsbot.length > 0) {
				await api.sendMessage({
					body: getLang("error", error.message)
				}, logsbot[0]);
			}
		} catch (notifyError) {
			console.error("❌ Could not send error notification:", notifyError);
		}
	},

	// Format uptime to human readable string
	formatUptime: function(milliseconds) {
		const seconds = Math.floor(milliseconds / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return `${days}d ${hours % 24}h ${minutes % 60}m`;
		} else if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	},

	// Manual test command
	onChat: async ({ event, api, getLang }) => {
		if (event.body?.toLowerCase() === "!testlog") {
			const { threadID, senderID } = event;

			// Simulate bot added event for testing
			const testEvent = {
				logMessageType: "log:subscribe",
				logMessageData: {
					addedParticipants: [{ userFbId: api.getCurrentUserID() }]
				},
				author: senderID,
				threadID: threadID
			};

			const mockContext = {
				usersData: { getName: async (id) => "Test User" },
				threadsData: { get: async (id) => ({ threadName: "Test Group" }) },
				event: testEvent,
				api: api,
				getLang: getLang
			};

			const handler = await module.exports.onStart(mockContext);
			if (typeof handler === 'function') {
				await handler();
			}
			await api.sendMessage("✅ Test log triggered!", threadID);
		}

		// Test restart notification
		if (event.body?.toLowerCase() === "!testrestart") {
			await module.exports.onRestart({ api, getLang });
			await api.sendMessage("✅ Test restart notification triggered!", event.threadID);
		}

		// Test startup notification
		if (event.body?.toLowerCase() === "!teststartup") {
			global.botStartTime = null; // Reset to trigger startup notification
			await module.exports.onReady({ api, getLang });
			await api.sendMessage("✅ Test startup notification triggered!", event.threadID);
		}
	}
};
