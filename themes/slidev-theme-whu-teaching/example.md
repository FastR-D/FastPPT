---
theme: slidev-theme-whu-teaching
layout: cover
title: 数据的运算及运算部件
courseTitle: 计算机组成原理 · 第三章
presenterName: 课程教学
sectionBar: true
info: WHU Teaching 主题版式示例；内容参考项目内第三章课件。
---

# 数据的运算及<br>运算部件

<span class="whu-cover-gold"></span>

第一讲：定点数运算及其运算部件

第二讲：浮点数运算及其运算部件

---
layout: toc
---

# 课程结构

---
layout: agenda
sectionStart: true
sectionLabel: 定点数运算
---

# 第一讲 定点数运算及其运算部件

::left::

## 高级语言程序中涉及的运算

以 C 语言为例：整数算术、浮点数算术、按位、逻辑与移位。

## 算术逻辑部件

ALU 的功能与实现。

::right::

## 定点数加减运算

补码加减运算、原码加减运算、移码加减运算。

## 定点数乘法运算

## 定点数除法运算

---
layout: default
---

# 回顾：n 位带标志加法器

普通加法器给出运算结果；标志位提供判断溢出、符号、零与进位的信息。

| 标志 | 名称            | 判断方式                       |
| ---- | --------------- | ------------------------------ |
| OF   | 溢出标志        | 符号位进位与最高数值位进位异或 |
| SF   | 符号标志        | 结果的最高位                   |
| ZF   | 零标志          | 结果全为 0 时置 1              |
| CF   | 进位 / 借位标志 | 依据加减操作解释进位输出       |

<WhuCallout title="注意">
带符号整数与无符号整数使用同一加法电路，但判断溢出的依据不同。
</WhuCallout>

---
layout: two-cols
---

# 数据的运算

::left::

<h2 class="whu-heading">高级语言程序中涉及的运算</h2>

- 整数算术运算、浮点数算术运算
- 按位运算与逻辑运算
- 移位、位扩展和位截断

<h2 class="whu-heading">指令集中涉及的运算</h2>

定点数运算分为算术运算与逻辑运算。运算指令的实现依赖数据通路中的运算部件。

::right::

<h2 class="whu-heading">定点数运算</h2>

带符号整数：取负、符号扩展、加减乘除与算术移位。

无符号整数：零扩展、加减乘除与逻辑移位。

<WhuCallout title="思考" kind="question">
浮点数有没有移位操作和扩展操作？为什么？
</WhuCallout>

---
layout: diagram
caption: 示意图：进位从低位逐级传向高位
---

# 串行进位加法器

::figure::

<div style="display: flex; align-items: center; gap: 12px; font-size: 23px;">
  <span>C₀</span><span>→</span>
  <div style="border: 2px solid var(--whu-primary); background: var(--whu-surface); padding: 26px 18px; text-align: center;"><strong>FA₀</strong><p>A₀, B₀</p><p>↓ S₀</p></div>
  <span>→</span>
  <div style="border: 2px solid var(--whu-primary); background: var(--whu-surface); padding: 26px 18px; text-align: center;"><strong>FA₁</strong><p>A₁, B₁</p><p>↓ S₁</p></div>
  <span>→</span><span>C₂</span>
</div>

::notes::

<h2 class="whu-heading">进位按串行方式传递</h2>

每一级全加器接收本位输入与低位传来的进位，产生本位和与下一位进位。

<WhuCallout title="关键观察">
高位结果需要等待低位进位，延迟随位数增加。
</WhuCallout>

---
layout: example
---

# 例：4 位无符号整数加法

::work::

| 步骤       | 二进制 | 十进制 |
| ---------- | ------ | ------ |
| 被加数 A   | 0110   | 6      |
| 加数 B     | 0011   | 3      |
| 结果 S     | 1001   | 9      |
| 最高位进位 | 0      | 无进位 |

<p class="whu-equation">0110 + 0011 = 1001</p>

::explanation::

<WhuStep number="1" title="明确数据类型">
本例将两个输入解释为 4 位无符号整数。
</WhuStep>

<WhuStep number="2" title="逐位计算">
从最低位开始相加，并将进位传给下一位。
</WhuStep>

<WhuStep number="3" title="检查结果范围">
9 在 0～15 范围内，没有无符号溢出。
</WhuStep>

---
layout: exercise
---

# 相同位串，不同的数值解释

::question::

将上一页的输入解释为 **4 位补码**：

<p class="whu-equation">0110 + 0011 = 1001</p>

1. 两个输入分别表示什么数？
2. 结果位串表示什么数？
3. 这次运算是否溢出？

::answer::

两个输入仍是 **+6** 与 **+3**。

4 位补码的表示范围是 **−8～+7**，数学结果 +9 超出范围。

<WhuCallout title="结论">
结果位串 1001 在补码中表示 −7；两个正数相加得到负数，说明发生了带符号溢出。
</WhuCallout>

---
layout: section
chapter: 第二讲 / 02
sectionLabel: 浮点数运算
---

# 浮点数运算及其运算部件

对阶、尾数运算、规格化与舍入。

---
layout: content
---

# 浮点数加减运算的基本步骤

<WhuBlock title="运算规则">

先统一两个操作数的阶码，再对尾数进行加减，最后对结果规格化并舍入。

</WhuBlock>

<WhuTable caption="浮点数加减运算流程" number="1" credit="依据参考课件中浮点数加减运算章节整理。">

| 阶段         | 操作           | 关注点               |
| ------------ | -------------- | -------------------- |
| 对阶         | 小阶向大阶看齐 | 尾数右移时保留附加位 |
| 尾数运算     | 尾数相加或相减 | 结果可能需要规格化   |
| 规格化与舍入 | 调整尾数和阶码 | 按选定舍入方式处理   |

</WhuTable>

<WhuTakeaway>

对阶时可能丢失低位信息，因此浮点运算需要考虑精度。

</WhuTakeaway>

---
layout: split
ratio: '3:2'
gap: lg
---

# 浮点数：数值表示与运算精度

::left::

<WhuNote title="有限位数，有限精度">

- 有限长度的尾数只能表示有限个有效位。
- 对阶、舍入都会影响低位信息。
- 数学上等价的表达式，计算结果可能不同。

</WhuNote>

<WhuCitation>

参考：项目内《第三章 数据的运算和运算部件_新版》，浮点数运算章节。

</WhuCitation>

::right::

<WhuFigure caption="浮点数的三个字段" number="1">

<div style="display: flex; width: 100%; gap: 8px; text-align: center;">
  <div style="padding: 28px 12px; background: var(--whu-surface); border-top: 4px solid var(--whu-accent); flex: 1;">符号</div>
  <div style="padding: 28px 12px; background: var(--whu-surface); border-top: 4px solid var(--whu-primary); flex: 2;">阶码</div>
  <div style="padding: 28px 12px; background: var(--whu-surface); border-top: 4px solid var(--whu-gold); flex: 3;">尾数</div>
</div>

</WhuFigure>

<WhuCallout title="思考" kind="question">

增加尾数位数，能否消除所有舍入误差？

</WhuCallout>

---
layout: end
---

# 本章小结

理解数值编码，分析运算规则，连接运算部件。

- 区分带符号与无符号整数的结果解释
- 认识进位路径对运算延迟的影响
- 使用例题与标志位检验运算结果
