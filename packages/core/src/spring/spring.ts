import { di } from "@elumixor/di";
import { all } from "@elumixor/frontils";
import { FileClient, SyncedFile } from "@spring/file-client";
import type { AiModel } from "ai-model";
import chalk from "chalk";
import type { ChatBot } from "chat-bot";
import type { Context } from "grammy";
import { ChunkedMessage, joinChunks } from "utils";
import { BehavioralCore } from "./behavioral-core";

export class Spring {
    private readonly behavior;
    private readonly chatIdFile;

    constructor(
        private readonly chat: ChatBot,
        private readonly aiModel: AiModel,
    ) {
        const fileClient = new FileClient(process.env.FILE_SERVER_URL);
        di.provide(FileClient, fileClient);

        this.behavior = new BehavioralCore(aiModel);
        this.chatIdFile = new SyncedFile(fileClient, "./chat-id.txt", "text");

        // Register event handlers from the chat
        chat.commandReceived.subscribe(({ ctx, command }) => this.onCommand(ctx, command));
        chat.textReceived.subscribe(({ text }) => this.onUserMessage(text));
        chat.voiceReceived.subscribe(async ({ buffer }) => {
            const text = await this.aiModel.voiceToText(buffer);
            this.onUserMessage(text);
        });

        // Register event handlers from the behavior
        this.behavior.sendMessageRequested.subscribe((text) => this.messageUser(text));
    }

    async wakeUp() {
        log(chalk.yellow("Spring: waking up"));
        await all(this.setUpChatId(), this.behavior.load());
        log(chalk.green("Spring: awake!"));
        await this.chat.sendText("(awake)");
    }

    async sleep() {
        await this.chat.sendText("(sleeping)");
        log(chalk.green("Spring: went to sleep..."));
        await Promise.resolve();
    }

    /* Handlers */

    /** This is the main part of execution */
    private onUserMessage(text: string) {
        log(`${chalk.cyan("User:")} ${text}`);
        void this.behavior.acceptMessage(text);
    }

    private async messageUser(text: string | ChunkedMessage) {
        if (!this.behavior.voicePreferred) {
            if (typeof text === "string") log(`${chalk.green("Spring:")} ${text}`);
            else void text.fullMessage.then((message) => log(`${chalk.green("Spring:")} ${message}`));
            return this.chat.sendText(text);
        }

        const mergedText = typeof text === "string" ? text : await joinChunks(text);
        const voiceBuffer = await this.aiModel.textToVoice(mergedText);
        return this.chat.sendVoice(voiceBuffer);
    }

    /* Commands */

    private async onCommand(_ctx: Context, command: string) {
        log(chalk.yellow(`User issued command: ${command}`));

        switch (command) {
            case "ping":
                await this.chat.sendText("Pong!");
                return;
            case "history":
                await this.chat.sendText(this.behavior.historyString);
                return;
            case "systemMessage":
                await this.chat.sendText(this.behavior.systemMessage);
                return;
            case "reset":
                await this.reset();
                return;
            case "shutdown":
                await this.sleep();
                await this.chat.stop();
                return;
            default:
                await this.chat.sendText("(unknown command)");
                return;
        }
    }

    private async reset() {
        await this.behavior.reset();
    }

    /* Utils */

    private async setUpChatId() {
        const id = await this.chatIdFile.initialize();
        const chatID = Number(id.trim());
        log(`Communicating with the last chat ID ${chatID}`);
        this.chat.chatId = chatID;
    }
}
