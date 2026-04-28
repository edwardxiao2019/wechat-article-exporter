import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { isDev } from '~/config';

interface AboutBizQuery {
  fakeid: string;
  key: string;
}

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) MicroMessenger/8.0.64(0x18004034) Language/zh_CN';

export default defineEventHandler(async event => {
  const { fakeid, key } = getQuery<AboutBizQuery>(event);

  const query: Record<string, string> = {
    __biz: fakeid,
    wx_header: process.env.NUXT_WECHAT_ABOUT_BIZ_WX_HEADER || '',
  };

  const rawHtml = await fetch(`https://mp.weixin.qq.com/mp/aboutbiz?${new URLSearchParams(query).toString()}`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'x-wechat-uin': process.env.NUXT_WECHAT_ABOUT_BIZ_UIN || '',
      'x-wechat-key': key || process.env.NUXT_WECHAT_ABOUT_BIZ_KEY || '',
    },
  }).then(resp => resp.text());

  // 写入文件方便调试
  if (isDev) {
    const safeFakeid = fakeid.replace(/[^A-Za-z0-9=+]/g, '_');
    fs.writeFileSync(`samples/aboutbiz/biz-${safeFakeid}.html`, rawHtml);
  }

  const result = extractInfo(rawHtml);
  if (Object.keys(result).length > 0) {
    return {
      base_resp: {
        ret: 0,
      },
      data: result,
    };
  } else {
    return {
      base_resp: {
        ret: -1,
        err_msg: '密钥已过期',
      },
    };
  }
});

function extractInfo(rawHTML: string) {
  const $ = cheerio.load(rawHTML);
  let $itemInfo = $('.about-page > .item-info:first');

  const result: Record<string, any> = {};

  while ($itemInfo.length > 0) {
    const title = $itemInfo.find('.item-title').text().trim();

    if (['公众号简介', '服务号简介'].includes(title)) {
      result.intro = $itemInfo.find('.item-desc').text().trim();
    } else if (title === '基础信息') {
      // nop
    } else if (title === '微信号') {
      result.wechat = $itemInfo.find('.item-desc').text().trim();
    } else if (['账号类型', '认证类型', '主体类型'].includes(title)) {
      result.type = $itemInfo.find('.item-desc').text().trim();
    } else if (['账号主体', '认证主体'].includes(title)) {
      result.org = $itemInfo.find('.item-desc').text().trim();
    } else if (title === 'IP属地') {
      // ip属地需要从 js 中获取
    } else if (title === '授权第三方服务') {
      result.auth_3rd_list = $itemInfo
        .extract({
          name: ['.principal-data'],
        })
        .name.map(item => item.trim());
    } else if (title === '名称记录') {
      result.name_records = $itemInfo
        .extract({
          name: ['.js_item'],
        })
        .name.map(item => item.trim());
    } else if (title === '客服电话') {
      result.phone = $itemInfo.find('.item-desc').text().trim();
    } else {
      console.log(`title: <${title}>`);
      console.log($itemInfo.text());
    }

    $itemInfo = $itemInfo.next('.item-info');
  }

  // ip_wording is a JS object literal, not a string: window.ip_wording = { countryName: '...', ... };
  const ipBlockMatch = rawHTML.match(/window\.ip_wording\s*=\s*\{([\s\S]*?)\};/);
  if (ipBlockMatch) {
    const ipObj: Record<string, string> = {};
    const kvRe = /(\w+):\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(ipBlockMatch[1])) !== null) {
      ipObj[m[1]] = m[2];
    }
    if (Object.keys(ipObj).length > 0) result.ip_wording = ipObj;
  }

  // auth_3rd_list items are added via window.cgiData.auth_3rd_list.push({...}), not the initial declaration.
  // category items contain JS expressions ('4'*1) so we only extract string fields before category:.
  const pushRe = /window\.cgiData\.auth_3rd_list\.push\(\{([\s\S]*?)\}\s*\)\s*;/g;
  const auth3rdList: Array<Record<string, string>> = [];
  let pm: RegExpExecArray | null;
  while ((pm = pushRe.exec(rawHTML)) !== null) {
    const topBlock = pm[1].split(/\s+category\s*:/)[0];
    const item: Record<string, string> = {};
    const kvRe2 = /(\w+):\s*'([^']*)'/g;
    let km: RegExpExecArray | null;
    while ((km = kvRe2.exec(topBlock)) !== null) {
      item[km[1]] = km[2];
    }
    if (Object.keys(item).length > 0) auth3rdList.push(item);
  }
  if (auth3rdList.length > 0) result.auth_3rd_list = auth3rdList;

  return result;
}
