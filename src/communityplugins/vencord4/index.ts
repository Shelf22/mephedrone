/*
 * Kaomoji for Vencord.
 * `bun run build` copies this file into
 * dist/vencord/kaomoji/ next to core.ts and emotes.json.
 */

import {
  ApplicationCommandInputType,
  ApplicationCommandOptionType,
  findOption,
  sendBotMessage,
} from '@api/Commands';
import { sendMessage } from '@utils/discord';
import definePlugin from '@utils/types';

import { buildKaomoji, commandInfo } from './core';

export default definePlugin({
  name: 'Kaomoji',
  description: 'Append kaomoji to your messages with /kaomoji',
  authors: [{ name: 'davidcralph', id: 0n }],
  commands: [
    {
      name: commandInfo.name,
      description: commandInfo.description,
      inputType: ApplicationCommandInputType.BUILT_IN,
      options: [
        {
          name: 'emotion',
          description: commandInfo.emotionDescription,
          type: ApplicationCommandOptionType.STRING,
          required: true,
        },
        {
          name: 'message',
          description: commandInfo.messageDescription,
          type: ApplicationCommandOptionType.STRING,
          required: false,
        },
        {
          name: 'index',
          description: commandInfo.indexDescription,
          type: ApplicationCommandOptionType.INTEGER,
          required: false,
        },
      ],
      execute(opts, ctx) {
        const result = buildKaomoji(
          findOption<string>(opts, 'emotion', ''),
          findOption<string>(opts, 'message'),
          findOption<number>(opts, 'index'),
        );

        if (result.ok) sendMessage(ctx.channel.id, { content: result.content });
        else sendBotMessage(ctx.channel.id, { content: result.error });
      },
    },
  ],
});
