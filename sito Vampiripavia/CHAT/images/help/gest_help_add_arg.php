<?
	include ("../db_connect.php");
	
	$argomento = $_POST['argomento'];	
	$id_capitolo = $_POST['id_capitolo'];
	
	OpenConnection();

	$sql = "";
	$sql .= "INSERT INTO help_argomenti(id_capitolo,pos,titolo) ";
	$sql .= "VALUES(".$id_capitolo.",1,'".$argomento."')";
	
	$query = mysql_query($sql);

	CloseConnection();		
	
	header("Location: gest_help.php");
?>