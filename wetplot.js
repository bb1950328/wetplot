const DEFAULT_LINE_CODE = "###default###";

// language=CSS
const WETPLOT_CSS = `
    .xAxisText {
        fill: #000000;
    }

    .linePath {
        fill: none;
    }

    .grid {
        fill: none;
        stroke: #666;
    }

    #hoverCursor {
        stroke: #000;
    }
`;

const COLOR_PALETTES = [
    [
        "#ff0000",
        //"#ffff00",
        "#00ff00",
        "#00ffff",
        "#0000ff",
        "#ff00ff"
    ], [
        "#ff0000",
        "#ff8000",
        //"#ffff00",
        "#80ff00",
        "#00ff00",
        "#00ff80",
        "#00ffff",
        "#0080ff",
        "#0000ff",
        "#8000ff",
        "#ff00ff",
        "#ff0080"
    ],
];

const TEXTS = {
    "TIME": {
        "en": "Time",
        "de": "Zeit",
        "fr": "Temps",
    }
}

function getText(key) {
    let object = TEXTS[key];
    if (object === undefined) {
        return "###" + key + "###";
    } else {
        let availableLanguages = Object.getOwnPropertyNames(object);
        let lang;
        let found = false;
        for (let i = 0; i < window.navigator.languages.length; i++) {
            lang = window.navigator.languages[i];
            if (lang.startsWith("en")) {
                lang = "en";
            }
            if (lang in availableLanguages) {
                found = true;
                break;
            }
        }
        if (!found) {
            lang = availableLanguages[0];
        }
        return object[lang];
    }
}

function createSvgElement(tagName = "svg") {
    return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function _split_to_digits(value) {
    let digits = [];
    while (value) {
        digits.push(value % 10);
        value = Math.floor(value / 10);
    }
    digits.reverse();
    return digits;
}

class WetplotDataController {
    constructor() {
        this.data = new WetplotData();
        this.data_providers = [];
    }

    /**
     * Add a function which gets called when the controller needs data.
     * It should return a instance of WetplotData or null if it can't provide data for the requested timespan
     * @param provider function(start_timestamp, end_timestamp)
     */
    addDataProvider(provider) {
        this.data_providers.push(provider);
    }
}

class Wetplot {
    constructor() {
        this._config = {
            rows: [],
            container_id: "wetplot-container",
            width: 1000,
            height: 500,
            background_color: "#c7c1a7",
            hover_box_background_color: "#fafafa",
            time_offset: Math.round(((+new Date()) - (1000 * 60 * 60 * 24)) / 1000),//in seconds, default is one day before
            time_lenght: 60 * 60 * 24 * 2, // in seconds
            seconds_per_pixel: 60,
            seconds_per_grid_line: 3600,
            num_horizontal_grid_lines: 20,
            caching_enabled: false,
            db_name: "wetplot",
            intervals: ["10min", "1hour", "24hour", "7days", "1month", "1year"],
            allow_scrolling_to_far: false, // allow user to scroll farther left than time_offset or farther right than time_offset+time_length
            font_size_px: 16,
        }
        this._line_config = {
            "###default###": {
                "type": "line",//"ybar" possible too
                "color": "#000000",
                "line_width": 2,
                "name": "?",
                "unit": "1",
                "auto_min_max": false,
                "min": -1,
                "max": 25,
            }
        }
        this._data = null;
        this._x_offset = 0;
        this._created_y_axes = [];
    }


    initialize() {
        this._svgElement = createSvgElement("svg");
        this._wrapperElement = document.getElementById(this._config["container_id"]);
        this._wrapperElement.appendChild(this._svgElement);
        //this._wrapperElement.style["width"] = this._config["width"] + "px";
        this._wrapperElement.style["height"] = this._config["height"] + "px";
        this._wrapperElement.style.display = "flex";
        this._svgElement.style.pointerEvents = "none";
        this._svgElement.style.position = "block";
        this._svgElement.style["width"] = this._config["width"] + "px";
        this._svgElement.style["height"] = this._config["height"] + "px";
        this._svgElement.style["background-color"] = this._config["background_color"];
        this._svgElement.setAttribute("width", this._config["width"]);
        this._svgElement.setAttribute("height", this._config["height"]);
        this._svgElement.setAttribute("viewBox", "0 0 " + this._config["width"] + " " + this._config["height"]);
        this._add_style();
        this._addPanEventListeners();
        this._openDb();
        this._rebuildAllLines();
        this._create_y_axis();
        this._draw_x_axis();
        this._draw_horizontal_grid();
        this._createHoverCursor();
    }

    _openDb(successCallback = (db) => {
    }) {
        let request = window.indexedDB.open(this._config["db_name"], 1);
        let time_intervals = this._config["intervals"];
        request.onerror = function (event) {
            console.error(event.target.errorCode);
        }
        request.onsuccess = function (event) {
            let db = event.target.result;
            successCallback(db);
        }
        request.onupgradeneeded = function (event) {
            console.log("DB update needed");
            let db = event.target.result;
            time_intervals.forEach(interval => {
                let objectStore = db.createObjectStore(interval, {keyPath: "Time"});
            });
        }
    }

    _addDataToDb(interval, wetplotData) {
        this._openDb((db) => {
            let transaction = db.transaction([interval], "readwrite");
            let objectStore = transaction.objectStore(interval);

            function addObj(obj) {
                console.debug("Add " + JSON.stringify(obj));
                objectStore.add(obj);
            }

            function updateObj(obj, previous) {
                if (previous === undefined) {
                    return addObj(obj);
                }
                let old_value = JSON.stringify(previous);
                Object.assign(previous, obj);
                let new_value = JSON.stringify(previous);
                if (old_value !== new_value) {
                    console.debug("Update " + old_value);
                    objectStore.put(previous);
                }
            }

            wetplotData.forEachObject(function (obj) {
                let request = objectStore.get(obj["Time"]);
                request.onsuccess = function (event) {
                    updateObj(obj, request.result);
                };
                request.onerror = function (event) {
                    addObj(obj);
                };
            });
            transaction.onabort = function (event) {
                console.error(event);
            }
        });
    }

    _getDataFromDb(interval, startTs, endTs, callback) {
        this._openDb((db) => {
            let transaction = db.transaction(interval);
            let objectStore = transaction.objectStore(interval);
            let request = objectStore.getAll(IDBKeyRange.bound(startTs, endTs));
            request.onsuccess = function (event) {
                callback(WetplotData.fromObjectArray(request.result));
            }
        });
    }

    _add_style() {
        const style = document.createElement('style');
        style.textContent = WETPLOT_CSS;
        document.head.append(style);
    }

    _draw_x_axis() {
        let group = createSvgElement("g");
        group.setAttribute("id", "xAxisGroup");
        this._svgElement.appendChild(group);

        let gridPath = createSvgElement("path");
        let gridD = "";

        let seconds_step = this._config["seconds_per_grid_line"];
        let seconds_start = this._config["time_offset"];
        let fontSize = this._config["font_size_px"];
        for (let secs = Math.round(seconds_start / seconds_step) * seconds_step; secs < seconds_start + this._config["time_lenght"]; secs += seconds_step) {
            let date = new Date(secs * 1000);
            let x = Math.round(this._seconds_to_x_coords(secs));
            let dateForHuman = date.toLocaleDateString() + " " + date.toLocaleTimeString();
            dateForHuman = dateForHuman.substring(0, dateForHuman.lastIndexOf(":")); // cut off seconds
            let txt = createSvgElement("text");
            txt.innerHTML = dateForHuman;
            txt.setAttribute("x", 0);
            txt.setAttribute("y", fontSize / 4);
            txt.setAttribute("transform", "rotate(90,0,0) translate(" + 10 + " " + -x + ")");
            txt.style.fontSize = fontSize + "px";
            txt.classList.add("xAxisText");
            group.appendChild(txt);

            gridD += "M" + x + " 0 V " + this._config["height"];
        }

        gridPath.setAttribute("d", gridD);
        gridPath.classList.add("grid");
        this._svgElement.appendChild(gridPath);
    }

    _draw_horizontal_grid() {
        let gridD = "";
        let num = this._config["num_horizontal_grid_lines"];
        let dist = this._config["height"] / (num + 1);
        for (let i = 1; i <= num; i++) {
            let y = Math.round(dist * i);
            gridD += "M 0 " + y + " H " + this._getXmax();
        }

        let pathElement = createSvgElement("path");
        pathElement.setAttribute("id", "horizontalGrid");
        pathElement.setAttribute("d", gridD);
        pathElement.classList.add("grid");
        this._svgElement.appendChild(pathElement);
    }

    _rebuildAllLines() {
        this.getAllLineCodes().forEach(lineCode => this._rebuildLine(lineCode));
    }

    _rebuildLine(lineCode) {
        let colNum = this._data.heads.indexOf(lineCode);
        let timeCol = this._data.heads.indexOf("Time");
        const config = this._line_config[lineCode];
        if (config["auto_min_max"]) {
            let [min, max] = this._data.getMinMaxForColumn(colNum);
            let padding = (max - min) / 100;
            config["min"] = min - padding;
            config["max"] = max + padding;
        }
        let path;
        let fill = false;
        if (config["type"] === "line") {
            path = "M";
            let first = true;
            for (let i = 0; i < this._data.values.length; i++) {
                let x = this._seconds_to_x_coords(this._data.values[i][timeCol]);
                let y = this._value_to_y_coord(lineCode, this._data.values[i][colNum]);
                if (first) {
                    first = false;
                } else {
                    path += " L";
                }
                path += (" " + Math.round(x) + " " + Math.round(y));
            }
        } else if (config["type"] === "ybar") {
            fill = true;
            let changingProperty = timestampSec => (new Date(timestampSec * 1000).getHours()); // todo make customizeable
            let lastPropertyValue = undefined;
            let aTs = this._config["time_offset"];
            let lastTimestamp = aTs;
            let sum = 0;
            let sumMax = 0;
            let data = [];
            for (let i = 0; i < this._data.values.length; i++) {
                let ts = this._data.values[i][timeCol];
                let nowPropertyValue = changingProperty(ts);
                if (lastPropertyValue !== undefined && lastPropertyValue !== nowPropertyValue) {
                    data.push([aTs, lastTimestamp, sum]);
                    aTs = ts;
                    sumMax = Math.max(sum, sumMax);
                    sum = 0;
                }
                sum += this._data.values[i][colNum];
                lastPropertyValue = nowPropertyValue;
                lastTimestamp = ts;
            }

            if (config["auto_min_max"]) {
                config["min"] = 0;
                config["max"] = sumMax * 1.01;
            }

            let y_zero = this._value_to_y_coord(lineCode, 0);
            path = "M 0 " + y_zero;
            for (let i = 0; i < data.length; i++) {
                aTs = data[i][0];
                let bTs = data[i][1];
                sum = data[i][2];

                let y = this._value_to_y_coord(lineCode, sum);
                let x1 = this._seconds_to_x_coords(aTs) + 1;//todo make something better than +1
                let x2 = this._seconds_to_x_coords(bTs) - 1;

                path += " H " + x1;
                path += " V " + y;
                path += " H " + x2;
                path += " V " + y_zero;
            }
            path += " Z";
        } else {
            console.error("Unknown type for line " + lineCode + ": \"" + config["type"] + "\"");
        }
        console.log(path);

        let pathElement = document.getElementById("path" + lineCode);
        if (pathElement === null) {
            pathElement = createSvgElement("path");
            this._svgElement.appendChild(pathElement);
            pathElement.style.stroke = config["color"];
            pathElement.style.strokeWidth = config["line_width"];
            pathElement.classList.add("linePath");
            if (fill) {
                pathElement.style.fill = config["color"];
                pathElement.style.fillOpacity = 0.4;
            }
        }
        pathElement.setAttribute("d", path);
    }

    _create_y_axis() {
        this._yAxisElement = createSvgElement("svg");
        this._yAxisElement.setAttribute("width", "0.01em");
        this._yAxisElement.setAttribute("height", this._config["height"]);
        this._yAxisElement.style.backgroundColor = this._config["background_color"];
        this.getAllLineCodes().forEach(code => this._add_y_axis_for_line_if_needed(code));
        this._wrapperElement.appendChild(this._yAxisElement);
    }

    _createHoverCursor() {
        let g = createSvgElement("g");
        this._svgElement.appendChild(g);
        g.setAttribute("id", "hoverCursor");
        let line = createSvgElement("path");
        g.appendChild(line);
        line.setAttribute("d", "M 0 0 V " + this._config["height"]);

        let catchelement = document.body;

        catchelement.addEventListener("mousemove", (event) => {
            this._cursorMoved(event);
        });
    }

    _cursorMoved(event) {
        let g = document.getElementById("hoverCursor");
        let bbox = this._svgElement.getBoundingClientRect();
        let m = 2;
        let inside =
            bbox.x + m < event.clientX &&
            event.clientX < bbox.right - m &&
            bbox.y + m < event.clientY &&
            event.clientY < bbox.bottom - m;
        if (inside) {
            g.style.display = "inline";
            let x_on_viewbox = event.clientX - bbox.x;
            let x_on_svg = x_on_viewbox + this._x_offset;
            g.setAttribute("transform", "translate(" + x_on_svg + " 0)");
            this._show_values_popup(x_on_svg, x_on_viewbox);
        } else {
            g.style.display = "none";
            this._hide_values_popup();
        }
    }

    _nearestTwoDataRows(timestamp) {
        let a = null;
        let b = null;
        let time_idx = this._data.heads.indexOf("Time");
        for (let i = 0; i < this._data.values.length; i++) {
            a = b;
            b = this._data.values[i];
            if (b[time_idx] > timestamp) {
                break;
            }
        }
        return [a, b];
    }

    _show_values_popup(x_svg, x_viewbox) {
        let cursorTimestampSeconds = this._x_coords_to_seconds(x_svg);
        let valuesPopupG = document.getElementById("valuesPopupG");
        let timeText = document.getElementById("valuesPopupTime");
        let bgPath = document.getElementById("valuesPopupBg");
        let scale = x => this._config["font_size_px"] * x

        if (valuesPopupG == null) {
            valuesPopupG = createSvgElement("g");
            valuesPopupG.setAttribute("id", "valuesPopupG");
            this._svgElement.appendChild(valuesPopupG);

            bgPath = createSvgElement("path");
            valuesPopupG.appendChild(bgPath);
            bgPath.style.fill = this._config["hover_box_background_color"];
            bgPath.style.fillOpacity = 0.75;
            bgPath.setAttribute("id", "valuesPopupBg");


            timeText = createSvgElement("text");
            timeText.setAttribute("id", "valuesPopupTime");
            timeText.style.fontSize = this._config["font_size_px"] + "px";
            valuesPopupG.appendChild(timeText);
        } else {
            valuesPopupG.style.display = "inline";
        }

        this.getAllLineCodes().forEach(lineCode => {
            let id = "valuesPopup" + lineCode;
            let txt = document.getElementById(id);
            if (txt == null) {
                txt = createSvgElement("text");
                txt.style.fontSize = this._config["font_size_px"] + "px";
                txt.classList.add("valueText");
                txt.setAttribute("id", id);
                valuesPopupG.appendChild(txt);
            }
        });

        let texts_x1 = scale(0.25);
        let texts_y = scale(1);

        let date = new Date(cursorTimestampSeconds * 1000);
        let localeDateStr = date.toLocaleString();
        localeDateStr = localeDateStr.substring(0, localeDateStr.lastIndexOf(":"));
        timeText.innerHTML = getText("TIME") + ": " + localeDateStr;
        timeText.setAttribute("y", texts_y);
        let maxTxtLength = timeText.innerHTML.length;

        let values = this._seconds_to_values(cursorTimestampSeconds);
        let valueElements = valuesPopupG.getElementsByClassName("valueText");
        for (let i = 0; i < valueElements.length; i++) {
            let txt = valueElements.item(i);
            let lineCode = txt.id.substring("valuesPopup".length);
            let text = this._line_config[lineCode]["name"] + ": "
                + (Math.round(values[lineCode] * 100) / 100) + " "
                + this._line_config[lineCode]["unit"];
            txt.innerHTML = text;
            maxTxtLength = Math.max(maxTxtLength, text.length);
            txt.style.fill = this._line_config[lineCode]["color"];

            texts_y += scale(1);
            txt.setAttribute("y", texts_y);
        }
        let bgWidth = Math.ceil(maxTxtLength / 4.5) * 2;
        let bgHeight = texts_y + scale(0.25);

        let estimatedBgHeight = scale(this.getAllLineCodes().length + 1.25);
        let abs_y1 = (this._config["height"] + estimatedBgHeight) / 2;

        if (x_viewbox / this._config["width"] > 0.5) {
            valuesPopupG.setAttribute("transform", "translate(" + (x_svg - scale(bgWidth + 1)) + ", " + abs_y1 + ")");
            bgPath.setAttribute("transform", "");
        } else {
            valuesPopupG.setAttribute("transform", "translate(" + x_svg + ", " + abs_y1 + ")");
            bgPath.setAttribute("transform", "rotate(180) translate(" + scale(-(bgWidth + 1)) + " " + (-1 * estimatedBgHeight) + ")");
            texts_x1 += scale(1);
        }

        timeText.setAttribute("x", texts_x1);
        for (let i = 0; i < valueElements.length; i++) {
            let txt = valueElements.item(i);
            txt.setAttribute("x", texts_x1);
        }

        bgPath.setAttribute("d", "M " + 0 + " 0" +
            " H " + scale(bgWidth) + // 1                               +-----1-----+
            " V " + bgHeight * 0.4 + // 2                               |           | 2
            " L " + scale(bgWidth + 1) + " " + 0.5 * bgHeight + // 3   |            \ 3
            " L " + scale(bgWidth) + " " + 0.6 * bgHeight + // 4        7            / 4
            " V " + bgHeight + // 5                                     |           | 5
            " H 0" +// 6                                                +-----6-----+
            " V 0" // 7
        );
    }

    _hide_values_popup() {
        let valuesPopupG = document.getElementById("valuesPopupG");
        if (valuesPopupG !== null) {
            valuesPopupG.style.display = "none";
        }
    }

    getAllLineCodes() {
        return Object.getOwnPropertyNames(this._line_config).filter(el => el !== DEFAULT_LINE_CODE);
    }

    numberToDisplayText(value, digitsAfterComma, maximum = undefined) {
        if (maximum === undefined) {
            maximum = value;
        }
        if (maximum <= 2000) {
            return value.toFixed(digitsAfterComma);
        }
        let all_suffixes = ["", "k", "m", "g", "t"];
        let digits = _split_to_digits(value);
        let suffix = "";
        while (digits.length + (suffix ? 1 : 0) > 4) {
            suffix = all_suffixes[all_suffixes.indexOf(suffix) + 1];
            let rest = digits.splice(digits.length - 3, 3);
            if (rest[0] >= 5) {
                digits = _split_to_digits(Number.parseInt(digits.join("")) + 1);
            }
        }
        return digits.join("") + suffix;
    }

    _get_min_max_for_unit(unit) {
        let [minVal, maxVal] = [undefined, undefined];
        this.getAllLineCodes().forEach(c => {
            if (this._line_config[c]["unit"] === unit) {
                let [minC, maxC] = [this._line_config[c]["min"], this._line_config[c]["max"]];
                if (minVal === undefined) {
                    minVal = minC;
                    maxVal = maxC;
                } else {
                    minVal = Math.min(minC, minVal);
                    maxVal = Math.max(maxC, maxVal);
                }
            }
        });
        return [minVal, maxVal];
    }

    _count_units() {
        let units = [];
        this.getAllLineCodes().forEach(c => {
            let u = this._line_config[c]["unit"];
            if (units.indexOf(u) === -1) {
                units.push(u);
            }
        });
        return units.length;
    }

    _add_y_axis_for_line_if_needed(code) {
        const Y_AXIS_WIDTH = 4;
        let unit = this._line_config[code]["unit"];
        let id = "group" + this._unit_to_id(unit);
        if (this._created_y_axes.indexOf(id) === -1 && this._yAxisElement) {
            this._created_y_axes.push(id);
            let fontSize = this._config["font_size_px"];
            let allCodes = this.getAllLineCodes();
            this._yAxisElement.setAttribute("width", this._count_units() * Y_AXIS_WIDTH * fontSize);

            let index = this._created_y_axes.length - 1;

            console.log("creating y axis for unit " + unit + ";" + index);
            let g = createSvgElement("g");
            g.setAttribute("id", id);
            g.setAttribute("fill", this._line_config[code]["color"]);

            //g.setAttribute("transform", "translate("+(index*100/allCodes.length)+"% 0)");
            this._yAxisElement.appendChild(g);
            let unitElement = createSvgElement("text");
            g.appendChild(unitElement);
            unitElement.innerHTML = unit;
            unitElement.style.fontSize = fontSize + "px";
            unitElement.setAttribute("y", fontSize);
            unitElement.setAttribute("x", (index * Y_AXIS_WIDTH + 0.5) * fontSize);

            let [minVal, maxVal] = this._get_min_max_for_unit(unit);

            let minValueStep = (fontSize * 1.2) / (this._config["height"] / (maxVal - minVal));
            let yValueDigitsAfterComma = 0;
            let yValueStep;
            if (minValueStep < 0.5) {
                yValueDigitsAfterComma = 1;
                let stp = minValueStep;
                while (stp < 0.05) {
                    yValueDigitsAfterComma++;
                    stp *= 10;
                }
                if (stp < 0.1) {
                    stp = 0.1;
                } else if (stp < 0.2) {
                    stp = 0.2;
                } else {
                    stp = 0.5;
                }
                stp /= (10 ** (yValueDigitsAfterComma - 1));
                yValueStep = stp;
            } else {
                yValueStep = Math.ceil(minValueStep);
            }

            if (yValueStep === 0) {
                console.warn("something is wrong, i can feel it");
                // prevent endless loop
                return;
            }

            let yMaxCoord = this._config["height"] - fontSize;
            let yValue = Math.floor(minVal);
            while (this._value_to_y_coord(code, yValue) > yMaxCoord) {
                //console.log(yValue);
                yValue += yValueStep;
            }
            let yCoord = this._value_to_y_coord(code, yValue);
            let ladderPath = ""
            let yFirstCoord = yCoord;
            let yLastCoord;
            let x = (index + 0.15) * Y_AXIS_WIDTH * fontSize;
            while (yCoord > fontSize * 2) {
                yLastCoord = yCoord;
                //console.log("val=" + yValue + "\tcoord=" + yCoord.toFixed(2) + "\tvalue_step=" + yValueStep);
                let txt = createSvgElement("text");
                txt.innerHTML = this.numberToDisplayText(yValue, yValueDigitsAfterComma);
                txt.setAttribute("y", yCoord + fontSize * 0.4);
                txt.setAttribute("x", x + fontSize / 3);
                txt.style.fontSize = fontSize + "px";
                g.appendChild(txt);

                ladderPath += "M " + x + " " + yCoord + " h " + (fontSize / -3).toFixed(2) + " ";
                yValue += yValueStep;
                yCoord = this._value_to_y_coord(code, yValue);
            }
            ladderPath += "M " + x + " " + yLastCoord + " V " + yFirstCoord;

            let pathElement = createSvgElement("path");
            pathElement.setAttribute("d", ladderPath);
            pathElement.setAttribute("id", "yLadder" + code);
            pathElement.setAttribute("stroke", this._line_config[code]["color"]);
            g.appendChild(pathElement);
        }
    }

    _unit_to_id(unit) {
        let id = encodeURI(unit.replace("°", "deg").replace("%", "percent"));
        while (id.indexOf("%") !== -1) {
            id = id.replace("%", "");
        }
        return id;
    }

    config(key, value = undefined) {
        if (value !== undefined) {
            this._config[key] = value;
        }
        return this._config[key];
    }

    addLine(lineId) {
        if (lineId === DEFAULT_LINE_CODE) {
            throw Error("invalid lineId");
        }
        this._line_config[lineId] = {...this._line_config[DEFAULT_LINE_CODE]};
        this._line_config[lineId]["name"] = lineId;
        this._add_y_axis_for_line_if_needed(lineId);
    }

    lineConfig(lineId, property, value = undefined) {
        if (value !== undefined) {
            this._line_config[lineId][property] = value;
        }
        return this._line_config[lineId][property];
    }

    addWetplotData(newData) {
        this._addDataToDb("10min", newData); // todo better solution than constant parameter
        if (this._data === null) {
            this._data = newData;
        } else {
            this._data = WetplotData.concatenate(this._data, newData);
        }
    }

    usePalette(paletteIndex) {
        let pal = COLOR_PALETTES[paletteIndex];
        let codes = this.getAllLineCodes();
        if (pal) {
            for (let i = 0; i < codes.length; i++) {
                this.lineConfig(codes[i], "color", pal[i % pal.length]);
            }
        }
    }

    _moveViewBoxPixels(pixels = 0, absolute = false) {
        if (!pixels) {
            return;
        }
        let [x1, y1, x2, y2] = this._svgElement.getAttribute("viewBox").split(" ");
        if (absolute) {
            x1 = pixels;
        } else {
            x1 = Number.parseInt(x1) + pixels;
        }
        if (!this._config["allow_scrolling_to_far"]) {
            x1 = Math.max(0, x1);
            let x1max = this._getXmax() - this._config["width"];
            x1 = Math.min(x1, x1max);
        }
        let newValue = [x1, y1, x2, y2].join(" ");
        this._x_offset = x1;
        this._svgElement.setAttribute("viewBox", newValue);
    }

    _getXmax() {
        return this._seconds_to_x_coords(this._config["time_offset"] + this._config["time_lenght"]);
    }

    _addPanEventListeners() {
        let wrapperElement = this._wrapperElement;
        let _last_mouse_move_x;
        wrapperElement.onwheel = (event) => {
            event.preventDefault();
            //console.log(event.deltaX);
            //console.log(event.deltaY);
            this._moveViewBoxPixels(event.deltaX * 10);
            this._moveViewBoxPixels(event.deltaY * 10);
            this._cursorMoved(event);
        }
        wrapperElement.onmousedown = (event) => {
            event.preventDefault();
            //console.log("mousedown");
            _last_mouse_move_x = event.pageX;

            let onMouseMove = (event) => {
                if (event.pageX <= 2 || event.pageX - 2 > window.innerWidth) {
                    stopDrag();
                    return;
                }
                let delta = _last_mouse_move_x - event.pageX;
                this._moveViewBoxPixels(delta);
                _last_mouse_move_x = event.pageX;
            }

            document.addEventListener('mousemove', onMouseMove);

            function stopDrag() {
                document.removeEventListener('mousemove', onMouseMove);
                wrapperElement.onmouseup = null;
            }

            wrapperElement.onmouseup = stopDrag;
        };
    }

    _seconds_to_x_coords(seconds) {
        return Math.round((seconds - this._config["time_offset"]) / this._config["seconds_per_pixel"]);
    }

    _x_coords_to_seconds(x_coord) {
        return x_coord * this._config["seconds_per_pixel"] + this._config["time_offset"]
    }

    _value_to_y_coord(lineCode, value) {
        let [min, max] = this._get_min_max_for_unit(this._line_config[lineCode]["unit"]);
        let span = max - min;
        return this._config["height"] - this._config["height"] * ((value - min) / span)
    }

    _y_coord_to_value(lineCode, y_coord) {
        let [min, max] = this._get_min_max_for_unit(this._line_config[lineCode]["unit"]);
        let span = max - min;
        return (this._config["height"] - y_coord) / this._config["height"] * span + min;
    }

    _seconds_to_values(timestamp) {
        let [a, b] = this._nearestTwoDataRows(timestamp);
        let result = {};
        let time_idx = this._data.heads.indexOf("Time");
        let aTs = a[time_idx];
        let bTs = b[time_idx];
        let exactPos = (timestamp - aTs) / (bTs - aTs);
        this.getAllLineCodes().forEach(lineCode => {
            let idx = this._data.heads.indexOf(lineCode);
            let aVal = a[idx];
            let bVal = b[idx];
            result[lineCode] = (aVal) + (bVal - aVal) * exactPos;
        });
        return result
    }

    scrollTo(value) {
        this._moveViewBoxPixels(value, true);
    }
}

class WetplotData {
    constructor(heads = [], values = []) {
        this.heads = heads;
        this.values = values;
    }

    getValue(rowIndex, columnName) {
        let row = this.values[rowIndex];
        return row ? row[this.getColumnIndex(columnName)] : undefined;
    }

    getColumnIndex(columnName) {
        return this.heads.indexOf(columnName);
    }

    static concatenate(a, b) {
        let result = new WetplotData();
        a.heads.forEach(result.heads.push);
        b.heads.forEach(head => {
            if (result.heads.indexOf(head) === -1) {
                result.push(head);
            }
        });
        let aTime0 = a.getValue(0, "Time");
        let bTime0 = b.getValue(0, "Time");
        let time_cursor = Math.min(aTime0, bTime0);
        let a_cursor = 0;
        let b_cursor = 0;
        let col_nums_a = {};
        let col_nums_b = {};
        result.heads.forEach(headName => {
            col_nums_a[headName] = a.getColumnIndex(headName);
            col_nums_b[headName] = b.getColumnIndex(headName);
        });
        while (a_cursor < a.values.length || b_cursor < b.values.length) {
            let diffA = a.getValue(a_cursor, "Time") - time_cursor;
            let diffB = b.getValue(b_cursor, "Time") - time_cursor;
            if (isNaN(diffB) || diffA <= diffB) {//todo fix duplication
                let row = [];
                let source_row = a.values[a_cursor];
                for (const head of result.heads) {
                    row.push(source_row[col_nums_a[head]]);
                }
                result.values.push(row);
                time_cursor = a.getValue(a_cursor, "Time");
                a_cursor++;
            }
            if (isNaN(diffA) || diffB <= diffA) {
                let row = [];
                let source_row = b.values[b_cursor];
                for (const head of result.heads) {
                    row.push(source_row[col_nums_b[head]]);
                }
                result.values.push(row);
                time_cursor = b.getValue(b_cursor, "Time");
                b_cursor++;
            }
        }
        return result;
    }

    static _add_columns(data, columns, fillvalue = null) {
        let num = columns.length;
        if (num <= 0) {
            return;
        }
        let rowcount = data.values.length;
        for (let row = 0; row < rowcount; row++) {
            for (let i = 0; i < num; i++) {
                data.values[row].push(fillvalue);
            }
        }
        columns.forEach(col => data.heads.push(col));
    }

    forEachObject(callbackFunction) {
        let obj = {};
        this.values.forEach(row => {
            for (let i = 0; i < this.heads.length; i++) {
                obj[this.heads[i]] = row[i];
            }
            callbackFunction({...obj});  // these weird dots are to clone the object
        });
    }

    static fromObjectArray(objArray = []) {
        let result = new WetplotData();
        objArray.forEach(obj => {
            let row = [];
            Object.getOwnPropertyNames(obj).forEach(key => {
                let colIndex = result.heads.indexOf(key);
                if (colIndex === -1) {
                    colIndex = result.heads.length;
                    result.heads.push(key);
                }
                row[colIndex] = obj[key];
            });
            result.values.push(row);
        });
        result.values.sort((a, b) => (a["Time"] > b["Time"]) ? 1 : ((b["Time"] > a["Time"]) ? -1 : 0));// todo check if its not reversed
        return result;
    }

    getMinMaxForColumn(colIndex = 0) {
        let minVal = undefined;
        let maxVal = undefined;
        for (let i = 0; i < this.values.length; i++) {
            let val = this.values[i][colIndex];
            if (val < minVal || minVal === undefined) {
                minVal = val;
            }
            if (val > maxVal || maxVal === undefined) {
                maxVal = val;
            }
        }
        return [minVal, maxVal];
    }
}
