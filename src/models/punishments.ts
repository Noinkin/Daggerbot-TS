import Discord from 'discord.js';
import TClient from '../client.js';
import ms from 'ms';
import {Punishment} from 'src/interfaces';
import DatabaseServer from '../components/DatabaseServer.js';
import {Model, DataTypes} from 'sequelize';
import CacheServer from '../components/CacheServer.js';
import Formatters from '../helpers/Formatters.js';

class punishments extends Model {
  declare public case_id: number;
  declare public type: string;
  declare public member_name: string;
  declare public member: string;
  declare public moderator: string;
  declare public expired: boolean;
  declare public time: number;
  declare public reason: string;
  declare public endTime: number;
  declare public cancels: number;
  declare public duration: number;
}

export class PunishmentsSvc {
  private client: TClient;
  private model: typeof punishments;

  constructor(client:TClient) {
    this.client = client;
    this.model = punishments;
    this.model.init({
      case_id: {
        type: DataTypes.INTEGER,
        unique: true,
        primaryKey: true
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false
      },
      member_name: {
        type: DataTypes.STRING,
        allowNull: true
      },
      member: {
        type: DataTypes.STRING,
        allowNull: false
      },
      moderator: {
        type: DataTypes.STRING,
        allowNull: false
      },
      expired: {
        type: DataTypes.BOOLEAN,
        allowNull: true
      },
      time: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: false
      },
      endTime: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      cancels: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      duration: {
        type: DataTypes.BIGINT,
        allowNull: true
      }
    }, {
      tableName: 'punishments',
      createdAt: false,
      updatedAt: false,
      sequelize: DatabaseServer.seq
    });
    this.model.sync();
  }
  query = async(pattern:string)=>await this.model.sequelize.query(pattern);
  async updateReason(caseId:number, reason:string) {
    const findCase = this.findCase(caseId);
    if (findCase) return this.model.update({reason: reason}, {where: {case_id: caseId}});
  }
  findCase =(caseId:number)=>this.model.findOne({where: {case_id: caseId}});
  findByCancels =(caseId:number)=>this.model.findOne({where: {cancels: caseId}})
  getAllCases =()=>this.model.findAll();
  async generateCaseId() {
    const result = await this.model.findAll();
    return Math.max(...result.map((x:Punishment)=>x.case_id), 0) + 1;
  }
  async findInCache():Promise<any> {
    const cacheKey = 'punishments';
    const cachedResult = await CacheServer.get(cacheKey, true);
    let result:any;
    if (cachedResult) result = cachedResult;
    else {
      result = await this.model.findAll();
      CacheServer.set(cacheKey, result, true).then(()=>CacheServer.expiry(cacheKey, 20));
    }
    return result;
  }
  async createModlog(punishment:Punishment) {
    let channel:Discord.TextChannelResolvable;
    switch (punishment.type) {
      case 'kick':
      case 'ban':
        channel = this.client.config.dcServer.channels.bankick_log;
        break;
      default:
        channel = this.client.config.dcServer.channels.logs;
        break;
    }
    const embed = new this.client.embed()
      .setColor(this.client.config.embedColor)
      .setTitle(`${punishment.type[0].toUpperCase() + punishment.type.slice(1)} | Case #${punishment.case_id}`)
      .addFields(
        {name: '🔹 User', value: `${punishment.member_name}\n<@${punishment.member}>\n\`${punishment.member}\``, inline: true},
        {name: '🔹 Moderator', value: `<@${punishment.moderator}>\n\`${punishment.moderator}\``, inline: true},
        {name: '\u200b', value: '\u200b', inline: true},
        {name: '🔹 Reason', value: `\`${punishment.reason}\``, inline: true}
      ).setTimestamp(punishment.time);
    if (punishment.duration) embed.addFields({name: '🔹 Duration', value: `${Formatters.timeFormat(punishment.duration, 4, {longNames: true, commas: true})}`, inline: true}, {name: '\u200b', value: '\u200b', inline: true});
    if (punishment.cancels) {
      const cancels = await this.model.findOne({where: {case_id: punishment.cancels}})
      embed.addFields({name: '🔹 Overwrites', value: `This case invalidates Case #${cancels.dataValues.case_id}\n\`${cancels.dataValues.reason}\``});
    }
    (this.client.channels.cache.get(channel) as Discord.TextChannel).send({embeds: [embed]});
  }
  getPastTense(type:string) {
    return {
      ban: 'banned',
      softban: 'softbanned',
      kick: 'kicked',
      mute: 'muted',
      warn: 'warned',
      remind: 'reminded'
    }[type];
  }
  async punishmentAdd(type:string, options:{time?:string, interaction?:Discord.ChatInputCommandInteraction}, moderator:string, reason: string, user:Discord.User, guildUser?:Discord.GuildMember) {
    const {time, interaction} = options;
    const now = Date.now();
    const guild = this.client.guilds.cache.get(this.client.config.dcServer.id) as Discord.Guild;
    const punishment:Punishment = {type, case_id: await this.generateCaseId(), member_name: user.username, member: user.id, reason, moderator, time: now};
    const inOrFromBoolean = ['warn', 'mute', 'remind'].includes(type) ? 'in' : 'from';
    const auditLogReason = `${reason ?? 'Reason unspecified'} | Case #${punishment.case_id}`;
    const embed = new this.client.embed()
      .setColor(this.client.config.embedColor)
      .setTitle(`${type[0].toUpperCase() + type.slice(1)} | Case #${punishment.case_id}`)
      .setDescription(`${user.username}\n<@${user.id}>\n\`${user.id}\``)
      .addFields({name: 'Reason', value: `\`${reason}\``});
    let punishmentResult:any;
    let millisecondTime:number;

    if (type === 'mute') millisecondTime = time ? ms(time) : 2419200000; // Timeouts have a maximum duration of 4 weeks (28 days)
    else millisecondTime = time ? ms(time) : null;

    const durText = millisecondTime ? ` for ${Formatters.timeFormat(millisecondTime, 4, {longNames: true, commas: true})}` : '';
    if (time) embed.addFields({name: 'Duration', value: durText});

    if (guildUser) await guildUser.send(`You've been ${this.getPastTense(type)} ${inOrFromBoolean} **${guild.name}**${durText}\n\`${reason}\` (Case #${punishment.case_id})`).catch(()=>embed.setFooter({text: 'Unable to DM a member'}));

    if (['ban', 'softban'].includes(type)) {
      const alreadyBanned = await guild.bans.fetch(user.id).catch(()=>null); // 172800 seconds is 48 hours, just for future reference
      if (!alreadyBanned) punishmentResult = await guild.bans.create(user.id, {reason: auditLogReason, deleteMessageSeconds: 172800}).catch((err:Error)=>err.message);
      else punishmentResult = `This user already exists in the guild\'s ban list.\nReason: \`${alreadyBanned?.reason}\``;
    } else if (type === 'kick') punishmentResult = await guildUser?.kick(auditLogReason).catch((err:Error)=>err.message);
    else if (type === 'mute') punishmentResult = await guildUser?.timeout(millisecondTime, auditLogReason).catch((err:Error)=>err.message);

    if (type === 'softban' && typeof punishmentResult !== 'string') punishmentResult = await guild.bans.remove(user.id, auditLogReason).catch((err:Error)=>err.message);

    if (millisecondTime && ['ban', 'mute'].includes(type)) {
      punishment.endTime = now + millisecondTime;
      punishment.duration = millisecondTime;
    }

    if (typeof punishmentResult === 'string') { // Punishment was unsuccessful
      if (interaction) return interaction.editReply(punishmentResult);
      else return punishmentResult;
    } else {
      const checkIfExists = await this.model.findOne({where: {case_id: punishment.case_id}});
      if (checkIfExists) this.model.update({expired: punishment.expired, time: punishment.time, endTime: punishment.endTime}, {where: {case_id: punishment.case_id}})
      else await this.model.create({
        case_id: punishment.case_id,
        type: punishment.type,
        member_name: punishment.member_name,
        member: punishment.member,
        moderator: punishment.moderator,
        expired: punishment.expired,
        time: punishment.time,
        reason: punishment.reason,
        endTime: punishment.endTime,
        cancels: punishment.cancels,
        duration: punishment.duration
      });
      await this.createModlog(punishment);

      if (interaction) return interaction.editReply({embeds: [embed]});
      else return punishmentResult;
    }
  }
  async punishmentRemove(caseId:number, moderator:string, reason:string, interaction?:Discord.ChatInputCommandInteraction) {
    const now = Date.now();
    const ID = await this.generateCaseId();
    const punishment = await this.model.findByPk(caseId);
    if (!punishment) return 'Case not found in database.';
    const guild = this.client.guilds.cache.get(this.client.config.dcServer.id) as Discord.Guild;
    const auditLogReason = `${reason ?? 'Reason unspecified'} | Case #${ID}`;
    const user = await this.client.users.fetch(punishment.member);
    const guildUser:Discord.GuildMember = await guild.members.fetch(punishment.member).catch(()=>null);

    let removePunishmentData:Punishment = {type: `un${punishment.type}`, case_id: ID, cancels: punishment.case_id, member_name: punishment.member_name, member: punishment.member, reason, moderator, time: now};
    let removePunishmentResult:any;

    if (punishment.type === 'ban') removePunishmentResult = await guild.bans.remove(punishment.member, auditLogReason).catch((err:Error)=>err.message);
    else if (punishment.type === 'mute') {
      if (guildUser) {
        removePunishmentResult = await guildUser.timeout(null, auditLogReason).catch((err:Error)=>err.message);
        guildUser.send(`You've been unmuted in **${guild.name}**.`).catch(()=>null);
      } else this.model.update({expired: true}, {where: {case_id: caseId}});
    } else removePunishmentData.type = 'punishmentOverride';

    if (typeof removePunishmentResult === 'string') {// Punishment was unsuccessful
      if (interaction) return interaction.editReply(removePunishmentResult);
      else return removePunishmentResult;
    } else {
      this.model.update({expired: true}, {where: {case_id: caseId}}).then(()=>
        this.model.create({
          case_id: removePunishmentData.case_id,
          type: removePunishmentData.type,
          member_name: removePunishmentData.member_name,
          member: removePunishmentData.member,
          moderator: removePunishmentData.moderator,
          expired: removePunishmentData.expired,
          time: removePunishmentData.time,
          reason: removePunishmentData.reason,
          endTime: removePunishmentData.endTime,
          cancels: removePunishmentData.cancels,
          duration: removePunishmentData.duration
        })
      );
      await this.createModlog(removePunishmentData);

      if (interaction) return interaction.reply({embeds: [new this.client.embed()
        .setColor(this.client.config.embedColor)
        .setTitle(`${removePunishmentData.type[0].toUpperCase() + removePunishmentData.type.slice(1)} | Case #${removePunishmentData.case_id}`)
        .setDescription(`${user.username}\n<@${user.id}>\n\`${user.id}\``)
        .addFields({name: 'Reason', value: `\`${reason}\``, inline: true}, {name: 'Overwrites', value: `Case #${punishment.case_id}`, inline: true})
      ]});
      else return `Successfully un${this.getPastTense(removePunishmentData.type.replace('un', ''))} ${user.username} (\`${user.id}\`) for ${reason}`
    }
  }
}
