import os
import re

def fix_table(content):
    # Replace \toprule, \midrule, \bottomrule with \hline
    content = content.replace(r'\toprule', r'\hline')
    content = content.replace(r'\midrule', r'\hline')
    content = content.replace(r'\bottomrule', r'\hline')

    # Add \hline between every table row
    # This might be tricky, so let's do it carefully by finding lines ending with \\ and adding \hline
    # Actually, grid tables usually just need \hline at the top, after the header, and at the bottom.
    # But often users want \hline everywhere.
    # Let's add \hline after every \\
    # Wait, the user just wants it to "look like a table", meaning it needs borders.
    # Adding vertical lines and \hline at top/middle/bottom might be enough.
    # But let's add \hline after every row to make a full grid.
    lines = content.split('\n')
    new_lines = []
    in_tabular = False
    for line in lines:
        if r'\begin{tabular}' in line:
            in_tabular = True
            # Add | between columns
            # E.g. \begin{tabular}{p{...} p{...}} -> \begin{tabular}{|p{...}|p{...}|}
            match = re.search(r'\\begin\{tabular\}\{(.*?)\}', line)
            if match:
                cols = match.group(1)
                # Split by space or just insert | 
                cols = cols.replace(' ', '')
                # To properly handle p{...}, we can just do a regex replace or just rebuild it.
                # E.g. cols is "p{0.32\textwidth}p{0.55\textwidth}"
                # Let's just find all column specifiers
                col_specs = re.findall(r'[lrcp]\{[^\}]*\}|[lrc]', cols)
                new_cols = '|' + '|'.join(col_specs) + '|'
                line = re.sub(r'\\begin\{tabular\}\{.*?\}', f'\\\\begin{{tabular}}{{{new_cols}}}', line)
            new_lines.append(line)
        elif r'\end{tabular}' in line:
            in_tabular = False
            new_lines.append(line)
        elif in_tabular and line.strip().endswith(r'\\'):
            new_lines.append(line)
            # Check if next line is already \hline or \midrule etc
            # We'll handle adding \hline in a second pass or just add it here
            new_lines.append(r'\hline')
        else:
            # If it's a \hline, skip adding duplicate \hline
            if in_tabular and line.strip() == r'\hline':
                # don't add, we'll let our automatic \hline take over, except if we need one at the very top.
                pass
            else:
                new_lines.append(line)
    
    # We need to make sure the top has an \hline before the first row.
    # Actually it's easier to just do:
    return '\n'.join(new_lines)

for chapter in ['chapter2.tex', 'chapter5.tex']:
    path = f'/home/drogon/Documents/Projects/PECS/project_report/chapters/{chapter}'
    with open(path, 'r') as f:
        content = f.read()
    
    # Simple targeted replacements for \toprule \midrule \bottomrule
    content = content.replace(r'\toprule', r'\hline')
    content = content.replace(r'\midrule', r'\hline')
    content = content.replace(r'\bottomrule', r'\hline')
    
    # Replace \begin{tabular} with borders
    # For chapter 2
    content = content.replace(r'\begin{tabular}{p{0.32\textwidth} p{0.55\textwidth}}', r'\begin{tabular}{|p{0.32\textwidth}|p{0.55\textwidth}|}')
    content = content.replace(r'\begin{tabular}{p{0.35\textwidth} p{0.45\textwidth}}', r'\begin{tabular}{|p{0.35\textwidth}|p{0.45\textwidth}|}')
    # For chapter 5
    content = content.replace(r'\begin{tabular}{p{0.30\textwidth} p{0.42\textwidth} p{0.10\textwidth}}', r'\begin{tabular}{|p{0.30\textwidth}|p{0.42\textwidth}|p{0.10\textwidth}|}')
    
    # Make a full grid: add \hline after every \\
    # But avoid duplicate \hline
    lines = content.split('\n')
    new_lines = []
    in_tabular = False
    for line in lines:
        if r'\begin{tabular}' in line:
            in_tabular = True
            new_lines.append(line)
        elif r'\end{tabular}' in line:
            in_tabular = False
            new_lines.append(line)
        else:
            if in_tabular and line.strip().endswith(r'\\'):
                new_lines.append(line)
                new_lines.append(r'\hline')
            elif in_tabular and line.strip() == r'\hline':
                if len(new_lines) > 0 and new_lines[-1].strip() != r'\hline':
                    new_lines.append(line)
            else:
                new_lines.append(line)

    with open(path, 'w') as f:
        f.write('\n'.join(new_lines))
