import Discord,{SlashCommandBuilder} from 'discord.js';
import { TClient } from 'src/client';
import * as util from 'node:util';
const removeUsername = (text: string)=>{
    let matchesLeft = true;
    const array = text.split('\\');
    while (matchesLeft){
        let usersIndex = array.indexOf('Users');
        if (usersIndex<1) matchesLeft = false;
        else {
            let usernameIndex = usersIndex+1;
            if(array[usernameIndex].length == 0) usernameIndex += 1;
            array[usernameIndex] = '*'.repeat(array[usernameIndex].length);
            array[usersIndex] = 'Us\u200bers';
        }
    } return array.join('\\');
};
export default {
    async run(client: TClient, interaction: Discord.ChatInputCommandInteraction<'cached'>) {
        if (!client.config.eval.allowed) return interaction.reply({content: 'Eval is disabled.', ephemeral: true});
        if (!client.config.eval.whitelist.includes(interaction.user.id)) return interaction.reply({content: 'You\'re not allowed to use this command.', ephemeral: true});
        const code = interaction.options.getString('code') as string;
        let output = 'error';
        let error = false;
        try {
            output = await eval(code);
        } catch (err: any) {
            error = true
            const embed = new client.embed().setColor('#ff0000').setTitle('__Eval__').addFields(
                {name: 'Input', value: `\`\`\`js\n${code.slice(0, 1010)}\n\`\`\``},
                {name: 'Output', value: `\`\`\`\n${err}\`\`\``}
            )
            interaction.reply({embeds: [embed]}).catch(()=>(interaction.channel as Discord.TextChannel).send({embeds: [embed]})).then(errorEmbedMessage=>{
                const filter = (x:any)=>x.content === 'stack' && x.author.id === interaction.user.id
                const messagecollector = (interaction.channel as Discord.TextChannel).createMessageCollector({filter, max: 1, time: 60000});
                messagecollector.on('collect', collected=>{
                    collected.reply({content: `\`\`\`\n${removeUsername(err.stack)}\n\`\`\``, allowedMentions: {repliedUser: false}});
                });
            });
        }
        if (error) return;
        if (typeof output == 'object') {
            output = 'js\n'+util.formatWithOptions({depth: 1}, '%O', output)        
        } else {
            output = '\n' + String(output);
        }
        [client.tokens.token_main,client.tokens.token_beta,client.tokens.token_toast,client.tokens.token_tae].forEach((x)=>{
            const regexp = new RegExp(x as string,'g');
            output = output.replace(regexp, 'TOKEN_LEAK');
        })
        const embed = new client.embed().setColor(client.config.embedColor).setTitle('__Eval__').addFields(
            {name: 'Input', value: `\`\`\`js\n${code.slice(0,1010)}\n\`\`\``},
            {name: 'Output', value: `\`\`\`${removeUsername(output).slice(0,1016)}\n\`\`\``}
        );
        interaction.reply({embeds: [embed]}).catch(()=>(interaction.channel as Discord.TextChannel).send({embeds: [embed]}))
    },
    data: new SlashCommandBuilder()
        .setName('eval')
        .setDescription('Run code for debugging purposes')
        .setDMPermission(false)
        .addStringOption((opt)=>opt
            .setName('code')
            .setDescription('Execute your code')
            .setRequired(true))
}