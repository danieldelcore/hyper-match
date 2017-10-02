const escapeHTML = require('escape-html');
const { exec } = require('child_process');
const {
    findMatches,
    getMatchOverlaps,
} = require('./lib/matcher');

const DEFAULT_CONFIG = {
    triggers: [
        {
            name: 'url',
            pattern: 'https?\\:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{2,256}\\.[a-z]{2,6}\\b([-a-zA-Z0-9@:%_\\+.~#?&//=]*)',
            options: 'gm',
            strategy: 'open "$&"',
            priority: 2,
        },
    ],
};

const styles = `
    x-screen a {
        color: #ff2e88;
        text-decoration: none;
    }

    x-screen a.hover {
        text-decoration: underline;
    }
`;

exports.getTermProps = function(uid, parentProps, props) {
    return Object.assign(props, { uid });
};

exports.decorateTerm = function(Term, { React }) {
    return class extends React.Component {
        constructor(props, context) {
            super(props, context);

            this.id = 0;
            this.onTerminal = this.onTerminal.bind(this);
        }

        onTerminal(term) {
            if (this.props.onTerminal) {
                this.props.onTerminal(term);
            }

            const userConfig = window.config.getConfig()['hyper-triggers'];

            this.config = Object.assign(DEFAULT_CONFIG, this.config);
            this.config.triggers = this.mergeTriggersById(DEFAULT_CONFIG.triggers, userConfig.triggers);
            this.term = term;

            const { screen_, onTerminalReady } = term;

            this.overrideScreen(screen_.constructor);

            const self = this;
            term.onTerminalReady = function() {
                onTerminalReady.apply(this, arguments);

                const screenNode = term.scrollPort_.getScreenNode();
                screenNode.addEventListener('click', self.onLinkClick.bind(self));
                screenNode.addEventListener('mouseover', self.onLinkMouseOver.bind(self));
                screenNode.addEventListener('mouseout', self.onLinkMouseOut.bind(self));
            };
        }

        overrideScreen(Screen) {
            if (Screen._links) return;
            Screen._links = true;

            const self = this;
            const { insertString, deleteChars } = Screen.prototype;

            Screen.prototype.insertString = function() {
                const result = insertString.apply(this, arguments);
                self.autolink(this);
                return result;
            };

            Screen.prototype.deleteChars = function() {
                const result = deleteChars.apply(this, arguments);
                self.autolink(this);
                return result;
            };
        }

        mergeTriggersById(defaultTriggers = [], userTriggers = []) {
            let uniqueTriggers = userTriggers.slice();

            return defaultTriggers
                .map(defaultTrigger => {
                    let trigger = defaultTrigger;
                    const foundTrigger = userTriggers
                        .find(userTrigger => userTrigger.name === defaultTrigger.name);

                    if (foundTrigger) {
                        uniqueTriggers = uniqueTriggers
                            .filter(trigger => trigger.name !== foundTrigger.name);
                        trigger = Object.assign({}, defaultTrigger, foundTrigger);
                        trigger.pattern = foundTrigger.pattern;
                    }

                    return trigger;
                })
                .concat(uniqueTriggers);
        }

        getAnchors(id) {
            const screenNode = this.term.scrollPort_.getScreenNode();
            return screenNode.querySelectorAll(`a[data-id="${id}"]`);
        }

        onLinkMouseOver(e) {
            if ('A' !== e.target.nodeName) return;

            const { id } = e.target.dataset;

            for (const a of this.getAnchors(id)) {
                a.classList.add('hover');
            }
        }

        onLinkMouseOut(e) {
            if ('A' !== e.target.nodeName) return;

            const { id } = e.target.dataset;

            for (const a of this.getAnchors(id)) {
                a.classList.remove('hover');
            }
        }

        onLinkClick(e) {
            if ('A' !== e.target.nodeName) return;

            e.preventDefault();

            const { innerText } = e.target;
            const name = e.target.getAttribute('data-trigger');
            const trigger = this.config.triggers.find(trigger => trigger.name === name);

            if (trigger) {
                const command = this.mapStrategy(innerText, trigger.strategy, trigger.options, trigger.pattern);
                exec(command);
            }
        }

        mapStrategy(text, strategy, options, pattern) {
            const re = new RegExp(pattern, options);

            return text
                .replace(re, strategy)
                .replace('$dirname', __dirname)
                .replace('$filename', __filename);
        }

        autolink(screen) {
            if ('#text' === screen.cursorNode_.nodeName) {
                // replace text node to element
                const cursorNode = document.createElement('span');
                cursorNode.textContent = screen.cursorNode_.textContent;
                screen.cursorRowNode_.replaceChild(cursorNode, screen.cursorNode_);
                screen.cursorNode_ = cursorNode;
            }

            const rows = [];
            let lastRow = screen.cursorRowNode_;

            while (true) {
                rows.unshift(lastRow);
                if (lastRow.children.length > 1) break;
                lastRow = lastRow.previousSibling;
                if (!lastRow || !lastRow.getAttribute('line-overflow')) break;
            }

            const textContent = rows.map(r => r.lastChild.textContent).join('');
            const matches = this.getMatches(textContent)
                .map(match => Object.assign(match, { id: this.id++ }));

            if (!matches || matches.length === 0) {
                return;
            }

            let rowStart = 0;
            let rowEnd = 0;
            let index = 0;

            const htmls = rows.map((row, i) => {
                rowStart = rowEnd;
                rowEnd += row.lastChild.textContent.length;

                let textStart = rowStart;
                let html = '';

                while (matches[index]) {
                    const {
                        id,
                        name,
                        linkColor,
                        start,
                        end,
                    } = matches[index];

                    if (start > textStart) {
                        const textEnd = start < rowEnd ? start : rowEnd;
                        html += escapeHTML(textContent.slice(textStart, textEnd));
                    }

                    if (start < rowEnd) {
                        const urlStart = start > rowStart ? start : rowStart;
                        const urlEnd = end < rowEnd ? end : rowEnd;
                        const style = linkColor ? `color: ${linkColor};` : '';

                        html += `<a href="#" style="${style}" data-id="${id}" data-trigger="${name}">`;
                        html += escapeHTML(textContent.slice(urlStart, urlEnd));
                        html += `</a>`;
                    }

                    if (end > rowEnd) break;

                    textStart = end;
                    index++;
                }

                if (!matches[index]) {
                    html += escapeHTML(textContent.slice(textStart, rowEnd));
                }

                return html;
            });

            for (let i = 0, l = rows.length; i < l; i++) {
                rows[i].lastChild.innerHTML = htmls[i];
            }
        }

        getMatches(textContent) {
            const { triggers } = this.config;
            const matches = triggers
                .reduce((sum, {
                    name,
                    priority,
                    pattern,
                    options,
                    linkColor,
                }) => {
                    const matches = findMatches(textContent, pattern, options)
                        .map(({ text, start, end }) => ({
                            name,
                            priority,
                            linkColor,
                            text,
                            start,
                            end,
                        }));

                    return sum.concat(matches);
                }, []);

            return this.filterOverlaps(matches);
        }

        filterOverlaps(matches) {
            const overlaps = getMatchOverlaps(matches)
                .map(({ previous, current }) =>
                    (previous.priority >= current.priority) ? current : previous);

            return matches.filter(match =>
                !overlaps.find(overlap => Object.is(match, overlap))
            );
        }

        render() {
            const props = Object.assign({}, this.props, {
                onTerminal: this.onTerminal,
                customCSS: styles + (this.props.customCSS || '')
            });

            return React.createElement(Term, props);
        }
    };
};
