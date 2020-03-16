// parser.js


String.prototype.rtrim = function(s) {
    if (s == undefined)
        s = '\\s';
    return this.replace(new RegExp("[" + s + "]*$"), '');
};
String.prototype.ltrim = function(s) {
    if (s == undefined)
        s = '\\s';
    return this.replace(new RegExp("^[" + s + "]*"), '');
};
String.prototype.splitLines = function() {
    return this.split(/\r\n|\r|\n/);
};


const FINISHED_GAME        = 'FINISHED_GAME';
const NOT_FINISHED_GAME    = 'NOT_FINISHED_GAME';
const FINISHED_WATCHED     = 'FINISHED_WATCHED';
const NOT_FINISHED_WATCHED = 'NOT_FINISHED_WATCHED';

const FLAG_BY_CATEGORY = new Map([
    ['  ', FINISHED_GAME],
    ['- ', NOT_FINISHED_GAME],
    [' -', NOT_FINISHED_GAME],
    [' @', FINISHED_WATCHED],
    ['@ ', FINISHED_WATCHED],
    ['-@', NOT_FINISHED_WATCHED],
    ['@-', NOT_FINISHED_WATCHED],
]);

const CATEGORY_BY_TITLE = new Map([
    [FINISHED_GAME,        "Пройденные"],
    [NOT_FINISHED_GAME,    "Не закончено прохождение"],
    [FINISHED_WATCHED,     "Просмотренные"],
    [NOT_FINISHED_WATCHED, "Не закончен просмотр"],
]);


// Регулярка вытаскивает выражения вида: 1, 2, 3 или 1-3, или римские цифры: III, IV
const PARSE_GAME_NAME_PATTERN = new RegExp(
    "(\\d+(, *?\\d+)+)|(\\d+ *?- *?\\d+)|([MDCLXVI]+(, ?[MDCLXVI]+)+)", "i"
);


function numberRange(start, end) {
    return new Array(end - start).fill().map((_, i) => start + i);
}


/**
  * Функция принимает название игры и пытается разобрать его, после возвращает список названий.
  * У некоторых игр в названии может указываться ее части или диапазон частей, поэтому для правильного
  * составления списка игр такие случаи нужно обрабатывать.
  * Пример:
  *     "Resident Evil 4, 5, 6" -> ["Resident Evil 4", "Resident Evil 5", "Resident Evil 6"]
  *     "Resident Evil 1-3"     -> ["Resident Evil", "Resident Evil 2", "Resident Evil 3"]
  *     "Resident Evil 4"       -> ["Resident Evil 4"]
 */
function parse_game_name(game_name) {
    let match = game_name.match(PARSE_GAME_NAME_PATTERN);
    if (match == null) {
        return [game_name];
    }

    let seq_str = match[0];

    // "Resident Evil 4, 5, 6" -> "Resident Evil"
    // For not valid "Trollface Quest 1-7-8" -> "Trollface Quest"
    let index = game_name.indexOf(seq_str);
    let base_name = game_name.substring(0, index).trim();

    seq_str = seq_str.replace(/ /g, '');
    let seq;

    if (seq_str.includes(',')) {
        // '1,2,3' -> ['1', '2', '3']
        seq = seq_str.split(',');

    } else if (seq_str.split('-').length == 2) {
        // ['1', '7'] -> [1, 7]
        let [start, end] = seq_str.split('-').map(x => parseInt(x));
        if (isNaN(start) || isNaN(end)) {
            return [game_name];
        }

        // [1, 7] -> ['1', '2', '3', '4', '5', '6', '7']
        seq = numberRange(start, end + 1).map(x => String(x));

    } else {
        return [game_name];
    }

    // Сразу проверяем номер игры в серии и если она первая, то не добавляем в названии ее номер
    return seq.map(x => x == '1' ? base_name : base_name + " " + x);
}


/**
 * Функция для парсинга файлов в gist.github.com
 *
 * @param {string} html_text
 * @return {string}
 */
function parse_gist_file(html_text) {
    function _process(node) {
        return node.text().rtrim().replace(/\u00a0/g, ' ');
    }

    let html = $('<div></div>').append($.parseHTML(html_text));

    // For debug
    let is_mobile = html.find('.gist-mobile-blob').length == 1;
    console.log("is_mobile: " + is_mobile);

    let lines = [];

    html.find('.js-file-line').each(function( index ) {
        lines.push(
            _process($(this))
        );
    });

    if (lines.length == 0) {
        show_error("No parse url_gist!");
        return null;
    }

    return lines.join('\n');
}


/**
 * Функция для парсинга списка игр.
 *
 * @param {string} text
 * @return {Map} platforms
 */
function parse_played_games(text) {
    let platforms = new Map();
    let platform = null;

    for (let line of text.splitLines()) {
        line = line.rtrim();
        if (!line) {
            continue;
        }

        flag = line.substring(0, 2);
        if (!FLAG_BY_CATEGORY.has(flag) && line.endsWith(':')) {
            const platform_name = line.slice(0, -1);

            platform = new Map([
                [FINISHED_GAME,        []],
                [NOT_FINISHED_GAME,    []],
                [FINISHED_WATCHED,     []],
                [NOT_FINISHED_WATCHED, []],
            ]);
            platforms.set(platform_name, platform);

            continue;
        }
        if (platform == null) {
            continue;
        }

        const category_name = FLAG_BY_CATEGORY.get(flag);
        if (category_name == null) {
            continue;
        }

        const category = platform.get(category_name);
        const game_name = line.substring(2);

        for (let game of parse_game_name(game_name)) {
            if (category.includes(game)) {
                continue
            }
            category.push(game);
        }
    }

    return platforms;
}


function getJsonObject(myMap) {
    function selfIterator(map) {
        return Array.from(map).reduce((acc, [key, value]) => {
            if (value instanceof Map) {
                acc[key] = selfIterator(value);
            } else {
                acc[key] = value;
            }

            return acc;
        }, {})
    }

    return selfIterator(myMap);
}


// SOURCE: https://stackoverflow.com/a/56646928/5909792
function stringifyMap(myMap) {
    return JSON.stringify(getJsonObject(myMap), null, 4);
}


function getJsonForTreeView(platforms) {
    let data = [];

    for (let [platform_name, categories] of platforms) {
        platform = {
            class: 'platform noselect text-truncate',
            text: platform_name,
            nodes: [],
            tags: [],
        };

        let total_games = 0;

        for (let [category_name, games] of categories) {
            let total = games.length;
            total_games += total;

            category = {
                class: `category ${category_name} noselect text-truncate`,
                text: CATEGORY_BY_TITLE.get(category_name),
                nodes: [],
                tags: [`${total}`],
            };
            platform.nodes.push(category);

            for (let game_name of games) {
                category.nodes.push({
                    class: `game ${category_name} noselect text-truncate`,
                    text: game_name,
                });
            }
        }

        platform.tags.push(`${total_games}`);

        data.push(platform);
    }
    return data;
}


function deep_compare(a, b) {
	if (typeof a !== typeof b) {
		return false;
    }

	if (typeof a !== 'object') {
		return a === b;
	}

	if (Object.keys(a).length != Object.keys(b).length) {
		return false;
    }

	if (Array.isArray(a) && Array.isArray(b)) {
		a.sort();
		b.sort();
	}

    if (a instanceof Map && b instanceof Map) {
        if (a.size != b.size) {
            return false;
        }

        for (let k of a.keys()) {
            if (!b.has(k)) {
                return false;
            }

            if (!deep_compare(a.get(k), b.get(k))) {
                return false;
            }
        }
    }

	for (let k in a) {
		if (!(k in b)) {
			return false;
        }

		if (!deep_compare(a[k], b[k])) {
			return false;
		}
	}

	return true;
}
